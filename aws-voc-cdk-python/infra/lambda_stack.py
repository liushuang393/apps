# -*- coding: utf-8 -*-
# 目的: Lambda関数の定義（NLP処理、S3テキスト取得）
# 入力: 設定情報、S3バケット情報
# 出力: Lambda関数オブジェクト
# 注意: DLQ統合、エラーハンドリング強化版
from aws_cdk import (Stack, Duration, aws_lambda as _lambda, aws_iam as iam, aws_sqs as sqs)
from aws_cdk.aws_lambda_python_alpha import PythonFunction, PythonFunctionProps, Runtime
from constructs import Construct
import os

class LambdaStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, buckets: dict, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        processed_bucket_name = buckets['processed'].bucket_name
        prefix = cfg['project']['prefix']

        # DLQ for Lambda failures
        nlp_dlq = sqs.Queue(self, 'NlpLambdaDlq',
            queue_name=f"{prefix}-nlp-lambda-dlq",
            retention_period=Duration.days(14),
            visibility_timeout=Duration.minutes(5)
        )

        fetch_dlq = sqs.Queue(self, 'FetchLambdaDlq',
            queue_name=f"{prefix}-fetch-lambda-dlq",
            retention_period=Duration.days(14),
            visibility_timeout=Duration.minutes(5)
        )

        # コスト最適化設定
        cost_config = cfg.get('cost_optimization', {})
        lambda_config = cost_config.get('lambda', {})
        reserved_concurrency = lambda_config.get('reserved_concurrent_executions', None)

        # NLP Lambda（awswrangler + pyarrow をバンドルして Parquet 直書き）
        self.nlp_lambda = PythonFunction(self, 'VocNlpFunction',
            entry=os.path.join(os.path.dirname(__file__), '..', 'lambda', 'voc_nlp'),
            index='handler.py',
            handler='handler',
            runtime=Runtime.PYTHON_3_12,
            timeout=Duration.seconds(180),
            memory_size=2048,
            environment={
                'PROCESSED_BUCKET': processed_bucket_name,
                'TARGET_LANG': cfg['bedrock']['target_lang'],
                'BEDROCK_MODEL_ID': cfg['bedrock']['model_id'],
                'ETL_MODE': cfg['etl']['mode'],   # lambda | glue
            },
            on_failure=_lambda.destinations.SqsDestination(nlp_dlq),
            retry_attempts=2,
            reserved_concurrent_executions=reserved_concurrency
        )

        # 権限（PoC広め）
        role = self.nlp_lambda.role
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('service-role/AWSLambdaBasicExecutionRole'))
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('AmazonS3FullAccess'))
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('ComprehendFullAccess'))
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('TranslateFullAccess'))
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('AmazonBedrockFullAccess'))

        buckets['processed'].grant_read_write(self.nlp_lambda)

        # s3_direct 用：S3オブジェクトからテキストを読み出す小Lambda
        self.fetch_s3text_lambda = _lambda.Function(self, 'FetchS3Text',
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler='handler.handler',
            code=_lambda.Code.from_asset(os.path.join(os.path.dirname(__file__), '..', 'lambda', 'fetch_s3text')),
            timeout=Duration.seconds(60),
            memory_size=512,
            on_failure=_lambda.destinations.SqsDestination(fetch_dlq),
            retry_attempts=2
        )
        buckets['raw'].grant_read(self.fetch_s3text_lambda)

        # DLQをクラス変数として保存（モニタリング用）
        self.nlp_dlq = nlp_dlq
        self.fetch_dlq = fetch_dlq
