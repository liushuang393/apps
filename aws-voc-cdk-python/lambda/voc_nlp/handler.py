# -*- coding: utf-8 -*-
# 目的: VOCテキストを翻訳→Comprehend→Bedrock要約→Parquet出力
# 入力: {"record": {"text": str, "lang": str (optional)}}
# 出力: {"ok": bool, "mode": str, "dt": str} or {"ok": False, "error": str, "msg": str}
# 注意: エラーハンドリング強化版、UTF-8/Shift_JIS対応
import os, json, uuid, datetime, logging
import boto3
import pandas as pd
import awswrangler as wr
from botocore.exceptions import ClientError

# ロギング設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS クライアント初期化
s3 = boto3.client('s3')
translate = boto3.client('translate')
comprehend = boto3.client('comprehend')
bedrock = boto3.client('bedrock-runtime')

# 環境変数
TARGET_LANG = os.environ.get('TARGET_LANG', 'ja')
PROCESSED_BUCKET = os.environ['PROCESSED_BUCKET']
MODEL_ID = os.environ.get('BEDROCK_MODEL_ID')
ETL_MODE = os.environ.get('ETL_MODE', 'lambda')  # lambda | glue

# 定数
MAX_TOKENS = 400
TEMPERATURE = 0.2
MAX_TEXT_LENGTH = 10000  # Comprehendの制限

def _bedrock_summarize(text, senti, kps, ents):
    """
    目的: Bedrockを使用してVOCテキストを要約
    入力: text(str), senti(dict), kps(dict), ents(dict)
    出力: {"summary": str, "comment": str, "suggestion": str}
    注意: Bedrock APIエラー時はデフォルト値を返す
    """
    try:
        prompt = f"""以下のVOCテキストを要約してください。また、担当者向けコメントと改善提案を短く出力してください。
# 原文:
{text[:1000]}
# 感情:
{senti}
# キーフレーズ:
{kps}
# エンティティ:
{ents}
出力形式: JSONで {{ "summary": "...", "comment": "...", "suggestion": "..." }}
"""
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
            "messages": [{"role":"user","content":[{"type":"text","text":prompt}]}]
        }
        resp = bedrock.invoke_model(
            modelId=MODEL_ID, contentType="application/json", accept="application/json",
            body=json.dumps(body)
        )
        out = json.loads(resp['body'].read())
        text_out = out["content"][0]["text"]
        try:
            return json.loads(text_out)
        except json.JSONDecodeError:
            return {"summary": text_out[:800], "comment": "", "suggestion": ""}

    except ClientError as e:
        logger.error(f"Bedrock API エラー: {e}")
        return {"summary": text[:500], "comment": "要約生成失敗", "suggestion": ""}
    except Exception as e:
        logger.error(f"予期しないエラー（Bedrock要約）: {e}")
        return {"summary": text[:500], "comment": "要約生成失敗", "suggestion": ""}

def handler(event, context):
    """
    目的: VOCテキストのNLP処理（翻訳、感情分析、要約）
    入力: {"record": {"text": str, "lang": str (optional)}}
    出力: {"ok": bool, "mode": str, "dt": str} or エラー情報
    注意: 全ての例外をキャッチしてエラー情報を返す
    """
    try:
        # 入力バリデーション
        record = (event or {}).get('record') or {}
        text = record.get('text')
        source_lang = record.get('lang')

        if not text:
            logger.warning("テキストが空です")
            return {"ok": False, "error": "validation", "msg": "テキストが空です"}

        if len(text) > MAX_TEXT_LENGTH:
            logger.warning(f"テキストが長すぎます: {len(text)} 文字")
            text = text[:MAX_TEXT_LENGTH]

        # 言語判定
        if not source_lang:
            try:
                ld = comprehend.detect_dominant_language(Text=text)
                source_lang = ld['Languages'][0]['LanguageCode']
            except ClientError as e:
                logger.error(f"言語判定エラー: {e}")
                source_lang = 'ja'  # デフォルト

        # 翻訳
        try:
            if source_lang != TARGET_LANG:
                tr = translate.translate_text(Text=text, SourceLanguageCode=source_lang, TargetLanguageCode=TARGET_LANG)
                text_tgt = tr['TranslatedText']
            else:
                text_tgt = text
        except ClientError as e:
            logger.error(f"翻訳エラー: {e}")
            text_tgt = text  # 翻訳失敗時は元のテキストを使用

        # Comprehend 分析
        try:
            senti = comprehend.detect_sentiment(Text=text_tgt, LanguageCode=TARGET_LANG)
            kps = comprehend.detect_key_phrases(Text=text_tgt, LanguageCode=TARGET_LANG)
            ents = comprehend.detect_entities(Text=text_tgt, LanguageCode=TARGET_LANG)
        except ClientError as e:
            logger.error(f"Comprehend分析エラー: {e}")
            senti = {"Sentiment": "NEUTRAL", "SentimentScore": {"Negative": 0.0}}
            kps = {"KeyPhrases": []}
            ents = {"Entities": []}

        # 要約
        gen = _bedrock_summarize(text_tgt, senti, kps, ents)

        # タイムスタンプ生成（UTC）
        now = datetime.datetime.now(datetime.timezone.utc)
        day = now.strftime('%Y-%m-%d')

        row = {
            "id": str(uuid.uuid4()),
            "ts_utc": now.isoformat(),
            "source_lang": source_lang,
            "text": text_tgt,
            "sentiment": senti.get("Sentiment"),
            "neg_score": senti.get("SentimentScore", {}).get("Negative"),
            "gen_summary": gen.get("summary"),
            "gen_comment": gen.get("comment"),
            "gen_suggestion": gen.get("suggestion"),
            "channel": "voc",
            "dt": day
        }

        # データ出力
        if ETL_MODE == "lambda":
            try:
                # Parquet 直書き（分割: dt, channel）
                df = pd.DataFrame([row])
                wr.s3.to_parquet(
                    df=df,
                    path=f"s3://{PROCESSED_BUCKET}/curated/",
                    dataset=True,
                    mode="append",
                    partition_cols=["dt", "channel"]
                )
                logger.info(f"Parquet出力成功: {row['id']}")
            except Exception as e:
                logger.error(f"Parquet出力エラー: {e}")
                raise
        else:
            try:
                # Glue ETL ルート: JSON を raw-json に出力（後段Glue Jobが Parquet 化）
                key = f"raw-json/dt={day}/channel=voc/{row['id']}.json"
                s3.put_object(
                    Bucket=PROCESSED_BUCKET,
                    Key=key,
                    Body=json.dumps(row, ensure_ascii=False).encode('utf-8'),
                    ContentType='application/json'
                )
                logger.info(f"JSON出力成功: {key}")
            except ClientError as e:
                logger.error(f"S3出力エラー: {e}")
                raise

        return {"ok": True, "mode": ETL_MODE, "dt": day, "id": row['id']}

    except ValueError as e:
        # バリデーションエラー
        logger.error(f"バリデーションエラー: {e}")
        return {"ok": False, "error": "validation", "msg": str(e)}

    except Exception as e:
        # 予期しないエラー
        logger.error(f"予期しないエラー: {e}", exc_info=True)
        return {"ok": False, "error": "internal", "msg": str(e)}
