# -*- coding: utf-8 -*-
# 目的: 統合テストの共通設定とフィクスチャ
# 注意: 実際のAWSリソースを使用

import pytest
import boto3
import yaml
import os
import time
from typing import Dict, Any

# 設定ファイルの読み込み
CONFIG_PATH = os.path.join(os.path.dirname(__file__), '../../config/config.yaml')

@pytest.fixture(scope='session')
def config() -> Dict[str, Any]:
    """
    目的: 設定ファイルを読み込む
    出力: 設定辞書
    """
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

@pytest.fixture(scope='session')
def aws_region(config) -> str:
    """
    目的: AWSリージョンを取得
    出力: リージョン名
    """
    return config['project']['region']

@pytest.fixture(scope='session')
def prefix(config) -> str:
    """
    目的: プロジェクトプレフィックスを取得
    出力: プレフィックス
    """
    return config['project']['prefix']

@pytest.fixture(scope='session')
def s3_client(aws_region):
    """
    目的: S3クライアントを作成
    出力: boto3 S3クライアント
    """
    return boto3.client('s3', region_name=aws_region)

@pytest.fixture(scope='session')
def lambda_client(aws_region):
    """
    目的: Lambdaクライアントを作成
    出力: boto3 Lambdaクライアント
    """
    return boto3.client('lambda', region_name=aws_region)

@pytest.fixture(scope='session')
def sfn_client(aws_region):
    """
    目的: Step Functionsクライアントを作成
    出力: boto3 Step Functionsクライアント
    """
    return boto3.client('stepfunctions', region_name=aws_region)

@pytest.fixture(scope='session')
def sqs_client(aws_region):
    """
    目的: SQSクライアントを作成
    出力: boto3 SQSクライアント
    """
    return boto3.client('sqs', region_name=aws_region)

@pytest.fixture(scope='session')
def athena_client(aws_region):
    """
    目的: Athenaクライアントを作成
    出力: boto3 Athenaクライアント
    """
    return boto3.client('athena', region_name=aws_region)

@pytest.fixture(scope='session')
def glue_client(aws_region):
    """
    目的: Glueクライアントを作成
    出力: boto3 Glueクライアント
    """
    return boto3.client('glue', region_name=aws_region)

@pytest.fixture(scope='session')
def cloudwatch_client(aws_region):
    """
    目的: CloudWatchクライアントを作成
    出力: boto3 CloudWatchクライアント
    """
    return boto3.client('cloudwatch', region_name=aws_region)

@pytest.fixture(scope='session')
def bucket_names(prefix):
    """
    目的: S3バケット名のリストを取得
    出力: バケット名の辞書
    """
    return {
        'raw': f"{prefix}-raw-apne1",
        'textract': f"{prefix}-textract-apne1",
        'processed': f"{prefix}-processed-apne1",
        'quicksight': f"{prefix}-quicksight-apne1",
        'archive': f"{prefix}-archive-apne1"
    }

@pytest.fixture
def test_file_uploader(s3_client, bucket_names):
    """
    目的: テストファイルをS3にアップロードするヘルパー
    出力: アップロード関数
    """
    uploaded_files = []
    
    def upload(content: str, key: str = None, encoding: str = 'utf-8') -> str:
        """
        テストファイルをアップロード
        
        Args:
            content: ファイル内容
            key: S3キー（Noneの場合は自動生成）
            encoding: 文字エンコーディング
        
        Returns:
            アップロードされたS3キー
        """
        if key is None:
            key = f"inbox/test_{int(time.time())}.txt"
        
        s3_client.put_object(
            Bucket=bucket_names['raw'],
            Key=key,
            Body=content.encode(encoding)
        )
        
        uploaded_files.append((bucket_names['raw'], key))
        return key
    
    yield upload
    
    # クリーンアップ
    for bucket, key in uploaded_files:
        try:
            s3_client.delete_object(Bucket=bucket, Key=key)
            print(f"クリーンアップ: s3://{bucket}/{key}")
        except Exception as e:
            print(f"クリーンアップ失敗: {e}")

@pytest.fixture
def wait_for_execution(sfn_client, prefix):
    """
    目的: Step Functionsの実行完了を待つヘルパー
    出力: 待機関数
    """
    def wait(max_wait: int = 300, check_interval: int = 10) -> bool:
        """
        Step Functionsの実行完了を待つ
        
        Args:
            max_wait: 最大待機時間（秒）
            check_interval: チェック間隔（秒）
        
        Returns:
            成功した場合True、タイムアウトの場合False
        """
        elapsed = 0
        
        # ステートマシンARNを取得
        response = sfn_client.list_state_machines()
        state_machines = [sm for sm in response['stateMachines'] if prefix in sm['name']]
        
        if len(state_machines) == 0:
            print("ステートマシンが見つかりません")
            return False
        
        sm_arn = state_machines[0]['stateMachineArn']
        
        while elapsed < max_wait:
            time.sleep(check_interval)
            elapsed += check_interval
            
            # 最新の実行を確認
            executions = sfn_client.list_executions(
                stateMachineArn=sm_arn,
                maxResults=1
            )
            
            if len(executions['executions']) > 0:
                latest = executions['executions'][0]
                status = latest['status']
                
                print(f"実行状態: {status} ({elapsed}秒経過)")
                
                if status == 'SUCCEEDED':
                    return True
                elif status in ['FAILED', 'TIMED_OUT', 'ABORTED']:
                    print(f"実行が失敗しました: {status}")
                    return False
        
        print(f"タイムアウト: {max_wait}秒")
        return False
    
    return wait

@pytest.fixture
def check_parquet_file(s3_client, bucket_names):
    """
    目的: Parquetファイルの生成を確認するヘルパー
    出力: 確認関数
    """
    def check(max_wait: int = 300, check_interval: int = 10) -> bool:
        """
        Parquetファイルの生成を確認
        
        Args:
            max_wait: 最大待機時間（秒）
            check_interval: チェック間隔（秒）
        
        Returns:
            ファイルが見つかった場合True、タイムアウトの場合False
        """
        elapsed = 0
        
        while elapsed < max_wait:
            time.sleep(check_interval)
            elapsed += check_interval
            
            try:
                response = s3_client.list_objects_v2(
                    Bucket=bucket_names['processed'],
                    Prefix='curated/'
                )
                
                if 'Contents' in response and len(response['Contents']) > 0:
                    print(f"Parquetファイルが見つかりました（{elapsed}秒後）")
                    return True
            except Exception as e:
                print(f"確認中: {e}")
        
        print(f"タイムアウト: {max_wait}秒")
        return False
    
    return check

@pytest.fixture
def check_dlq_messages(sqs_client, prefix):
    """
    目的: DLQのメッセージを確認するヘルパー
    出力: 確認関数
    """
    def check() -> int:
        """
        DLQのメッセージ数を確認
        
        Returns:
            メッセージ数
        """
        response = sqs_client.list_queues(QueueNamePrefix=prefix)
        
        if 'QueueUrls' not in response:
            return 0
        
        total_messages = 0
        
        for queue_url in response['QueueUrls']:
            if 'dlq' in queue_url.lower():
                attrs = sqs_client.get_queue_attributes(
                    QueueUrl=queue_url,
                    AttributeNames=['ApproximateNumberOfMessages']
                )
                
                count = int(attrs['Attributes']['ApproximateNumberOfMessages'])
                total_messages += count
                
                if count > 0:
                    print(f"DLQにメッセージがあります: {queue_url} ({count}件)")
        
        return total_messages
    
    return check

def pytest_configure(config):
    """
    目的: pytestの設定
    """
    config.addinivalue_line(
        "markers", "integration: mark test as integration test (requires AWS deployment)"
    )

def pytest_collection_modifyitems(config, items):
    """
    目的: 統合テストのマーカーを自動追加
    """
    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(pytest.mark.integration)

