"""
AI プロバイダー接続テスト

Gemini API と OpenAI Realtime API の接続確認用テスト。
環境変数から API キーを読み込んでテストを実行する。

実行方法:
    docker exec lams-mvp-backend-1 python -m pytest tests/test_ai_providers.py -v
    または
    docker exec lams-mvp-backend-1 python tests/test_ai_providers.py
"""
import asyncio
import os
import sys

# テスト結果の色付け出力
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def print_result(name: str, success: bool, message: str = "") -> None:
    """テスト結果を色付きで出力"""
    status = f"{GREEN}✓ PASS{RESET}" if success else f"{RED}✗ FAIL{RESET}"
    print(f"{status} {name}")
    if message:
        print(f"       {message}")


async def test_gemini_api() -> bool:
    """
    Gemini API 接続テスト
    シンプルなテキスト生成でAPIが動作するか確認
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    base_url = os.getenv("GEMINI_BASE_URL", "")
    model = os.getenv("GEMINI_MODEL", "models/gemini-2.5-flash")

    if not api_key or api_key == "your_gemini_api_key":
        print_result("Gemini API", False, "GEMINI_API_KEY が設定されていません")
        return False

    try:
        from google import genai
        from google.genai import types as genai_types

        # base_url が空でなければ設定
        http_options = None
        if base_url and base_url != "https://gemini.googleapis.com":
            http_options = genai_types.HttpOptions(base_url=base_url)

        client = genai.Client(api_key=api_key, http_options=http_options)

        # シンプルなテキスト生成テスト
        response = client.models.generate_content(
            model=model,
            contents="Say 'Hello, LAMS!' in one short sentence.",
        )

        if response.text:
            print_result("Gemini API", True, f"応答: {response.text[:50]}...")
            return True
        else:
            print_result("Gemini API", False, "応答が空です")
            return False

    except Exception as e:
        print_result("Gemini API", False, f"エラー: {e}")
        return False


async def test_openai_api() -> bool:
    """
    OpenAI API 接続テスト
    通常の Chat Completions でAPIが動作するか確認
    （Realtime API は WebSocket なので簡易テストは Chat で代用）
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "")

    if not api_key or api_key == "your_openai_api_key":
        print_result("OpenAI API", False, "OPENAI_API_KEY が設定されていません")
        return False

    try:
        from openai import AsyncOpenAI

        # base_url が空の場合は None を渡す
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
        )

        # シンプルな Chat Completions テスト
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Say 'Hello, LAMS!' in one short sentence."}],
            max_tokens=50,
        )

        if response.choices and response.choices[0].message.content:
            text = response.choices[0].message.content
            print_result("OpenAI API", True, f"応答: {text[:50]}...")
            return True
        else:
            print_result("OpenAI API", False, "応答が空です")
            return False

    except Exception as e:
        print_result("OpenAI API", False, f"エラー: {e}")
        return False


async def main() -> int:
    """メイン関数：両APIをテスト"""
    print(f"\n{YELLOW}=== AI プロバイダー接続テスト ==={RESET}\n")

    # 環境変数の確認
    print(f"AI_PROVIDER: {os.getenv('AI_PROVIDER', '未設定')}")
    print(f"GEMINI_MODEL: {os.getenv('GEMINI_MODEL', '未設定')}")
    print(f"OPENAI_REALTIME_MODEL: {os.getenv('OPENAI_REALTIME_MODEL', '未設定')}")
    print()

    results = []

    # Gemini テスト
    results.append(await test_gemini_api())

    # OpenAI テスト
    results.append(await test_openai_api())

    # 結果サマリー
    print(f"\n{YELLOW}=== 結果サマリー ==={RESET}")
    passed = sum(results)
    total = len(results)
    print(f"合格: {passed}/{total}")

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

