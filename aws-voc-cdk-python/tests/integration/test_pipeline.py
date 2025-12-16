# -*- coding: utf-8 -*-
# 目的: パイプライン全体の統合テスト
# 注意: デプロイ後に実行、実際のAWSリソースを使用

import pytest
import boto3
import time
import os
import yaml

# 設定ファイルの読み込み
with open(os.path.join(os.path.dirname(__file__), '../../config/config.yaml'), 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

prefix = config['project']['prefix']
region = config['project']['region']

# AWSクライアント
s3 = boto3.client('s3', region_name=region)
sfn = boto3.client('stepfunctions', region_name=region)
athena = boto3.client('athena', region_name=region)

@pytest.mark.integration
def test_s3_buckets_exist():
    """
    目的: S3バケットが存在することを確認
    入力: なし
    出力: 全バケットが存在する
    """
    buckets = [
        f"{prefix}-raw-apne1",
        f"{prefix}-textract-apne1",
        f"{prefix}-processed-apne1",
        f"{prefix}-quicksight-apne1",
        f"{prefix}-archive-apne1"
    ]
    
    response = s3.list_buckets()
    bucket_names = [b['Name'] for b in response['Buckets']]
    
    for bucket in buckets:
        assert bucket in bucket_names, f"バケット {bucket} が存在しません"

@pytest.mark.integration
def test_step_functions_exists():
    """
    目的: Step Functionsステートマシンが存在することを確認
    入力: なし
    出力: ステートマシンが存在する
    """
    response = sfn.list_state_machines()
    state_machines = [sm['name'] for sm in response['stateMachines']]
    
    expected_name = f"{prefix}-pipeline-VocPipelineSm"
    
    # 部分一致で検索
    found = any(expected_name in name or prefix in name for name in state_machines)
    assert found, f"ステートマシン {expected_name} が見つかりません"

@pytest.mark.integration
def test_end_to_end_pipeline():
    """
    目的: エンドツーエンドのパイプラインテスト
    入力: テストファイルをS3にアップロード
    出力: Parquetファイルが生成される
    """
    # テストファイルの作成
    test_text = "この製品は素晴らしい。使いやすくて満足しています。"
    test_key = f"inbox/test_{int(time.time())}.txt"
    raw_bucket = f"{prefix}-raw-apne1"
    processed_bucket = f"{prefix}-processed-apne1"
    
    # S3にアップロード
    s3.put_object(
        Bucket=raw_bucket,
        Key=test_key,
        Body=test_text.encode('utf-8')
    )
    
    print(f"テストファイルをアップロード: s3://{raw_bucket}/{test_key}")
    
    # Step Functionsの実行を待つ（最大5分）
    max_wait = 300  # 5分
    wait_interval = 10  # 10秒
    elapsed = 0
    
    while elapsed < max_wait:
        time.sleep(wait_interval)
        elapsed += wait_interval
        
        # processedバケットにファイルが作成されたか確認
        try:
            response = s3.list_objects_v2(
                Bucket=processed_bucket,
                Prefix='curated/'
            )
            
            if 'Contents' in response and len(response['Contents']) > 0:
                print(f"Parquetファイルが生成されました（{elapsed}秒後）")
                # クリーンアップ
                s3.delete_object(Bucket=raw_bucket, Key=test_key)
                return
        except Exception as e:
            print(f"確認中: {e}")
    
    # クリーンアップ
    s3.delete_object(Bucket=raw_bucket, Key=test_key)
    pytest.fail(f"タイムアウト: {max_wait}秒以内にParquetファイルが生成されませんでした")

@pytest.mark.integration
def test_athena_query():
    """
    目的: Athenaでクエリが実行できることを確認
    入力: なし
    出力: クエリが成功する
    """
    database = config['athena']['database_name']
    workgroup = config['athena']['workgroup_name']
    result_location = config['athena']['result_location_s3']
    
    # シンプルなクエリを実行
    query = f"SHOW TABLES IN {database}"
    
    response = athena.start_query_execution(
        QueryString=query,
        QueryExecutionContext={'Database': database},
        ResultConfiguration={'OutputLocation': result_location},
        WorkGroup=workgroup
    )
    
    query_execution_id = response['QueryExecutionId']
    
    # クエリの完了を待つ
    max_wait = 60
    wait_interval = 2
    elapsed = 0
    
    while elapsed < max_wait:
        time.sleep(wait_interval)
        elapsed += wait_interval
        
        result = athena.get_query_execution(QueryExecutionId=query_execution_id)
        status = result['QueryExecution']['Status']['State']
        
        if status == 'SUCCEEDED':
            print(f"Athenaクエリが成功しました（{elapsed}秒後）")
            return
        elif status in ['FAILED', 'CANCELLED']:
            pytest.fail(f"Athenaクエリが失敗しました: {status}")
    
    pytest.fail(f"タイムアウト: {max_wait}秒以内にクエリが完了しませんでした")

@pytest.mark.integration
def test_dlq_exists():
    """
    目的: DLQが存在することを確認
    入力: なし
    出力: DLQが存在する
    """
    sqs = boto3.client('sqs', region_name=region)
    response = sqs.list_queues(QueueNamePrefix=prefix)

    if 'QueueUrls' not in response:
        pytest.fail("DLQが見つかりません")

    queue_names = [url.split('/')[-1] for url in response['QueueUrls']]

    # DLQの存在確認
    dlq_found = any('dlq' in name.lower() for name in queue_names)
    assert dlq_found, "DLQが見つかりません"

    print(f"DLQが見つかりました: {[n for n in queue_names if 'dlq' in n.lower()]}")

@pytest.mark.integration
def test_lambda_functions_exist():
    """
    目的: Lambda関数が存在することを確認
    入力: なし
    出力: 全Lambda関数が存在する
    """
    lambda_client = boto3.client('lambda', region_name=region)
    response = lambda_client.list_functions()
    function_names = [f['FunctionName'] for f in response['Functions']]

    expected_functions = [
        'fetch',  # fetch_s3text
        'nlp',    # voc_nlp
        'quicksight'  # quicksight_lambda
    ]

    for func in expected_functions:
        found = any(func in name.lower() for name in function_names)
        assert found, f"Lambda関数 {func} が見つかりません"

    print(f"Lambda関数が見つかりました: {len([n for n in function_names if prefix in n])}個")

@pytest.mark.integration
def test_cloudwatch_alarms_exist():
    """
    目的: CloudWatchアラームが存在することを確認
    入力: なし
    出力: アラームが存在する
    """
    cloudwatch = boto3.client('cloudwatch', region_name=region)
    response = cloudwatch.describe_alarms(AlarmNamePrefix=prefix)

    alarms = response['MetricAlarms']
    assert len(alarms) > 0, "CloudWatchアラームが見つかりません"

    print(f"CloudWatchアラームが見つかりました: {len(alarms)}個")
    for alarm in alarms:
        print(f"  - {alarm['AlarmName']}: {alarm['StateValue']}")

@pytest.mark.integration
def test_glue_crawler_exists():
    """
    目的: Glue Crawlerが存在することを確認
    入力: なし
    出力: Crawlerが存在する
    """
    glue = boto3.client('glue', region_name=region)

    try:
        response = glue.get_crawler(Name=f"{prefix}-voc-crawler")
        assert response['Crawler']['State'] in ['READY', 'RUNNING'], \
            f"Crawlerの状態が異常です: {response['Crawler']['State']}"
        print(f"Glue Crawlerが見つかりました: {response['Crawler']['State']}")
    except glue.exceptions.EntityNotFoundException:
        pytest.fail("Glue Crawlerが見つかりません")

@pytest.mark.integration
def test_end_to_end_with_japanese_text():
    """
    目的: 日本語テキストのエンドツーエンドテスト
    入力: 日本語のテストファイル
    出力: 正常に処理される
    """
    test_text = """
    この商品は本当に素晴らしいです。
    使いやすくて、デザインも美しい。
    カスタマーサポートも親切でした。
    強くお勧めします！
    """
    test_key = f"inbox/test_japanese_{int(time.time())}.txt"
    raw_bucket = f"{prefix}-raw-apne1"

    # S3にアップロード
    s3.put_object(
        Bucket=raw_bucket,
        Key=test_key,
        Body=test_text.encode('utf-8')
    )

    print(f"日本語テストファイルをアップロード: s3://{raw_bucket}/{test_key}")

    # Step Functionsの実行を確認
    time.sleep(30)  # EventBridgeのトリガーを待つ

    # ステートマシンの実行履歴を確認
    response = sfn.list_state_machines()
    state_machines = [sm for sm in response['stateMachines'] if prefix in sm['name']]

    if len(state_machines) > 0:
        sm_arn = state_machines[0]['stateMachineArn']
        executions = sfn.list_executions(
            stateMachineArn=sm_arn,
            maxResults=10
        )

        print(f"最近の実行: {len(executions['executions'])}件")

        # 最新の実行が成功または実行中であることを確認
        if len(executions['executions']) > 0:
            latest = executions['executions'][0]
            print(f"最新の実行状態: {latest['status']}")
            assert latest['status'] in ['RUNNING', 'SUCCEEDED'], \
                f"実行が失敗しました: {latest['status']}"

    # クリーンアップ
    s3.delete_object(Bucket=raw_bucket, Key=test_key)

@pytest.mark.integration
def test_error_handling_invalid_file():
    """
    目的: 無効なファイルのエラーハンドリングテスト
    入力: 空のファイル
    出力: エラーが適切に処理される
    """
    test_key = f"inbox/test_empty_{int(time.time())}.txt"
    raw_bucket = f"{prefix}-raw-apne1"

    # 空ファイルをアップロード
    s3.put_object(
        Bucket=raw_bucket,
        Key=test_key,
        Body=b''
    )

    print(f"空ファイルをアップロード: s3://{raw_bucket}/{test_key}")

    # 処理を待つ
    time.sleep(30)

    # DLQにメッセージが入っていないことを確認（空ファイルは正常処理される）
    sqs = boto3.client('sqs', region_name=region)
    response = sqs.list_queues(QueueNamePrefix=prefix)

    if 'QueueUrls' in response:
        for queue_url in response['QueueUrls']:
            if 'dlq' in queue_url.lower():
                messages = sqs.receive_message(
                    QueueUrl=queue_url,
                    MaxNumberOfMessages=10
                )
                # 空ファイルは正常処理されるため、DLQにメッセージがないことを確認
                assert 'Messages' not in messages or len(messages.get('Messages', [])) == 0, \
                    "空ファイルがDLQに入りました（予期しない動作）"

    # クリーンアップ
    s3.delete_object(Bucket=raw_bucket, Key=test_key)
    print("空ファイルのテストが成功しました")

