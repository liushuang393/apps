# -*- coding: utf-8 -*-
# 目的: S3オブジェクトからテキストを取得
# 入力: EventBridge S3イベント（bucket, key）または手動テスト用の{"text": str}
# 出力: {"text": str} or {"text": "", "error": str}
# 注意: UTF-8/Shift_JIS/CP932に対応、エラーハンドリング強化版
import json, boto3, logging
from botocore.exceptions import ClientError

# ロギング設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')

# サポートする文字エンコーディング
SUPPORTED_ENCODINGS = ['utf-8', 'shift_jis', 'cp932', 'iso-2022-jp']

def handler(event, context):
    """
    目的: S3オブジェクトからテキストを取得
    入力: EventBridge S3イベントまたは手動テスト用データ
    出力: {"text": str} or エラー情報
    注意: 複数の文字コードに対応
    """
    try:
        # EventBridgeからのS3 putイベント形式を想定
        # event['detail']['bucket']['name'], event['detail']['object']['key']
        detail = event.get('detail', {})
        bucket = detail.get('bucket', {}).get('name')
        key = detail.get('object', {}).get('key')

        if not bucket or not key:
            # 手動テスト用: 直接テキストを渡せるよう fallback
            text = (event or {}).get('text')
            if text:
                logger.info("手動テストモード: テキストを直接受信")
                return {"text": text}
            else:
                logger.warning("バケットまたはキーが指定されていません")
                return {"text": "", "error": "validation", "msg": "バケットまたはキーが指定されていません"}

        # S3からオブジェクトを取得
        try:
            logger.info(f"S3オブジェクト取得: s3://{bucket}/{key}")
            obj = s3.get_object(Bucket=bucket, Key=key)
            body = obj['Body'].read()
        except ClientError as e:
            error_code = e.response['Error']['Code']
            logger.error(f"S3取得エラー ({error_code}): {e}")
            if error_code == 'NoSuchKey':
                return {"text": "", "error": "not_found", "msg": f"ファイルが見つかりません: {key}"}
            elif error_code == 'AccessDenied':
                return {"text": "", "error": "access_denied", "msg": f"アクセス拒否: {key}"}
            else:
                return {"text": "", "error": "s3_error", "msg": str(e)}

        # 文字コード自動判定
        text = None
        for encoding in SUPPORTED_ENCODINGS:
            try:
                text = body.decode(encoding)
                logger.info(f"文字コード判定成功: {encoding}")
                break
            except (UnicodeDecodeError, LookupError):
                continue

        if text is None:
            logger.error(f"サポートされていない文字コード: {key}")
            return {"text": "", "error": "encoding", "msg": f"サポートされていない文字コード: {key}"}

        logger.info(f"テキスト取得成功: {len(text)} 文字")
        return {"text": text}

    except Exception as e:
        # 予期しないエラー
        logger.error(f"予期しないエラー: {e}", exc_info=True)
        return {"text": "", "error": "internal", "msg": str(e)}
