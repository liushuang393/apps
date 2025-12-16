# -*- coding: utf-8 -*-
# 目的: pytest共通設定とフィクスチャ
# 注意: 全テストで共有されるセットアップ

import os
import pytest
import boto3
from moto import mock_aws

@pytest.fixture(scope='function')
def aws_credentials():
    """
    目的: AWS認証情報のモック
    出力: 環境変数を設定
    注意: テスト実行時のみ有効
    """
    os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
    os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
    os.environ['AWS_SECURITY_TOKEN'] = 'testing'
    os.environ['AWS_SESSION_TOKEN'] = 'testing'
    os.environ['AWS_DEFAULT_REGION'] = 'ap-northeast-1'

@pytest.fixture(scope='function')
def s3_client(aws_credentials):
    """
    目的: S3クライアントのモック
    出力: boto3 S3クライアント
    注意: motoを使用してモック化
    """
    with mock_aws():
        yield boto3.client('s3', region_name='ap-northeast-1')

@pytest.fixture(scope='function')
def s3_bucket(s3_client):
    """
    目的: テスト用S3バケットの作成
    出力: バケット名
    注意: テスト終了後は自動削除
    """
    bucket_name = 'test-voc-bucket'
    s3_client.create_bucket(
        Bucket=bucket_name,
        CreateBucketConfiguration={'LocationConstraint': 'ap-northeast-1'}
    )
    return bucket_name

@pytest.fixture(scope='function')
def lambda_env():
    """
    目的: Lambda環境変数のモック
    出力: 環境変数辞書
    注意: テスト実行時のみ有効
    """
    env = {
        'PROCESSED_BUCKET': 'test-processed-bucket',
        'TARGET_LANG': 'ja',
        'BEDROCK_MODEL_ID': 'anthropic.claude-3-sonnet-20240229-v1:0',
        'ETL_MODE': 'lambda'
    }
    for key, value in env.items():
        os.environ[key] = value
    return env

