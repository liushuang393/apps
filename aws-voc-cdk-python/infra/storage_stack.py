# -*- coding: utf-8 -*-
# 目的: S3バケットの定義（コスト最適化版）
# 入力: 設定情報
# 出力: S3バケット
# 注意: ライフサイクルルール、暗号化、バージョニング設定
from aws_cdk import (Stack, RemovalPolicy, Duration, aws_s3 as s3)
from constructs import Construct

class StorageStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        p = cfg['buckets']

        # コスト最適化設定
        cost_config = cfg.get('cost_optimization', {})
        raw_archive_days = cost_config.get('s3_lifecycle_rules', {}).get('raw_archive_days', 90)
        processed_archive_days = cost_config.get('s3_lifecycle_rules', {}).get('processed_archive_days', 365)

        # Rawバケット（ライフサイクルルール付き）
        self.raw = s3.Bucket(self, 'RawBucket',
            bucket_name=p['raw'],
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id='ArchiveOldFiles',
                    enabled=True,
                    transitions=[
                        s3.Transition(
                            storage_class=s3.StorageClass.GLACIER,
                            transition_after=Duration.days(raw_archive_days)
                        )
                    ]
                )
            ]
        )

        self.textract = s3.Bucket(self, 'TextractBucket',
            bucket_name=p['textract'],
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN
        )

        # Processedバケット（ライフサイクルルール付き）
        self.processed = s3.Bucket(self, 'ProcessedBucket',
            bucket_name=p['processed'],
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id='ArchiveOldParquet',
                    enabled=True,
                    prefix='curated/',
                    transitions=[
                        s3.Transition(
                            storage_class=s3.StorageClass.INTELLIGENT_TIERING,
                            transition_after=Duration.days(processed_archive_days)
                        )
                    ]
                )
            ]
        )

        self.quicksight = s3.Bucket(self, 'QuicksightBucket',
            bucket_name=p['quicksight'],
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN
        )

        self.archive = s3.Bucket(self, 'ArchiveBucket',
            bucket_name=p['archive'],
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN
        )

        self.outputs = {
            'raw': self.raw,
            'textract': self.textract,
            'processed': self.processed,
            'quicksight': self.quicksight,
            'archive': self.archive,
        }
