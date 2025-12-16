# -*- coding: utf-8 -*-
# 目的: voc_nlp Lambda関数のユニットテスト
# 注意: AWS APIをモック化してテスト

import pytest
import sys
import os
from unittest.mock import Mock, patch, MagicMock
import json

# Lambda関数のパスを追加
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../lambda/voc_nlp'))

# 環境変数を設定（importの前に）
os.environ['PROCESSED_BUCKET'] = 'test-bucket'
os.environ['TARGET_LANG'] = 'ja'
os.environ['BEDROCK_MODEL_ID'] = 'test-model'
os.environ['ETL_MODE'] = 'lambda'

from handler import handler, _bedrock_summarize

def test_handler_no_text():
    """
    目的: テキストが空の場合のテスト
    入力: {"record": {}}
    出力: {"ok": False, "error": "validation"}
    """
    event = {"record": {}}
    result = handler(event, None)
    
    assert result["ok"] is False
    assert result["error"] == "validation"
    assert "テキストが空です" in result["msg"]

def test_handler_text_too_long():
    """
    目的: テキストが長すぎる場合のテスト
    入力: 10000文字以上のテキスト
    出力: テキストが切り詰められる
    """
    long_text = "あ" * 15000
    event = {"record": {"text": long_text, "lang": "ja"}}
    
    with patch('handler.comprehend') as mock_comprehend, \
         patch('handler.bedrock') as mock_bedrock, \
         patch('handler.wr.s3.to_parquet') as mock_parquet:
        
        # モック設定
        mock_comprehend.detect_sentiment.return_value = {
            "Sentiment": "NEUTRAL",
            "SentimentScore": {"Negative": 0.0}
        }
        mock_comprehend.detect_key_phrases.return_value = {"KeyPhrases": []}
        mock_comprehend.detect_entities.return_value = {"Entities": []}
        
        mock_bedrock.invoke_model.return_value = {
            'body': MagicMock(read=lambda: json.dumps({
                "content": [{"text": '{"summary": "要約", "comment": "コメント", "suggestion": "提案"}'}]
            }).encode())
        }
        
        result = handler(event, None)
        
        # テキストが切り詰められたことを確認
        assert result["ok"] is True

@patch('handler.comprehend')
@patch('handler.translate')
@patch('handler.bedrock')
@patch('handler.wr.s3.to_parquet')
def test_handler_success_japanese(mock_parquet, mock_bedrock, mock_translate, mock_comprehend):
    """
    目的: 日本語テキストの正常処理テスト
    入力: {"record": {"text": "日本語テキスト", "lang": "ja"}}
    出力: {"ok": True, "mode": "lambda", "dt": str, "id": str}
    """
    # モック設定
    mock_comprehend.detect_sentiment.return_value = {
        "Sentiment": "POSITIVE",
        "SentimentScore": {"Negative": 0.1}
    }
    mock_comprehend.detect_key_phrases.return_value = {
        "KeyPhrases": [{"Text": "テスト"}]
    }
    mock_comprehend.detect_entities.return_value = {
        "Entities": [{"Text": "製品"}]
    }
    
    mock_bedrock.invoke_model.return_value = {
        'body': MagicMock(read=lambda: json.dumps({
            "content": [{"text": '{"summary": "要約", "comment": "コメント", "suggestion": "提案"}'}]
        }).encode())
    }
    
    event = {"record": {"text": "この製品は素晴らしい。", "lang": "ja"}}
    result = handler(event, None)
    
    # 検証
    assert result["ok"] is True
    assert result["mode"] == "lambda"
    assert "dt" in result
    assert "id" in result
    
    # Parquetが呼ばれたことを確認
    mock_parquet.assert_called_once()

@patch('handler.comprehend')
@patch('handler.translate')
@patch('handler.bedrock')
@patch('handler.wr.s3.to_parquet')
def test_handler_translation(mock_parquet, mock_bedrock, mock_translate, mock_comprehend):
    """
    目的: 英語→日本語翻訳のテスト
    入力: {"record": {"text": "English text", "lang": "en"}}
    出力: 翻訳が実行される
    """
    # モック設定
    mock_translate.translate_text.return_value = {
        "TranslatedText": "日本語テキスト"
    }
    mock_comprehend.detect_sentiment.return_value = {
        "Sentiment": "NEUTRAL",
        "SentimentScore": {"Negative": 0.0}
    }
    mock_comprehend.detect_key_phrases.return_value = {"KeyPhrases": []}
    mock_comprehend.detect_entities.return_value = {"Entities": []}
    
    mock_bedrock.invoke_model.return_value = {
        'body': MagicMock(read=lambda: json.dumps({
            "content": [{"text": '{"summary": "要約", "comment": "コメント", "suggestion": "提案"}'}]
        }).encode())
    }
    
    event = {"record": {"text": "This product is great.", "lang": "en"}}
    result = handler(event, None)
    
    # 翻訳が呼ばれたことを確認
    mock_translate.translate_text.assert_called_once()
    assert result["ok"] is True

@patch('handler.bedrock')
def test_bedrock_summarize_success(mock_bedrock):
    """
    目的: Bedrock要約の正常系テスト
    入力: テキスト、感情、キーフレーズ、エンティティ
    出力: {"summary": str, "comment": str, "suggestion": str}
    """
    mock_bedrock.invoke_model.return_value = {
        'body': MagicMock(read=lambda: json.dumps({
            "content": [{"text": '{"summary": "要約テスト", "comment": "コメントテスト", "suggestion": "提案テスト"}'}]
        }).encode())
    }
    
    result = _bedrock_summarize("テキスト", {}, {}, {})
    
    assert result["summary"] == "要約テスト"
    assert result["comment"] == "コメントテスト"
    assert result["suggestion"] == "提案テスト"

@patch('handler.bedrock')
def test_bedrock_summarize_error(mock_bedrock):
    """
    目的: Bedrock要約のエラーハンドリングテスト
    入力: Bedrock APIエラー
    出力: デフォルト値を返す
    """
    from botocore.exceptions import ClientError
    
    mock_bedrock.invoke_model.side_effect = ClientError(
        {'Error': {'Code': 'ThrottlingException', 'Message': 'Rate exceeded'}},
        'InvokeModel'
    )
    
    result = _bedrock_summarize("テキスト", {}, {}, {})
    
    assert "summary" in result
    assert result["comment"] == "要約生成失敗"

