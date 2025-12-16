# Gcal Twilio Reminder

## 概要
このツールは、Google カレンダーの予定を自動チェックし、Twilio 経由で電話および SMS によるリマインドを送信します。
指定した時間窓（デフォルトは 55〜65 分前）にイベントが存在する場合、自動的に通知を送信します。
CLI オプションにより、手動実行やドライラン（送信せずに確認）も可能です。

---

## 主な機能
- Google カレンダーの予定取得（OAuth2 対応）
- Twilio による SMS / 音声通話リマインド
- SQLite による送信履歴管理（重複送信防止）
- CLI パラメータ対応（`--dry-run`, `--window-min`, `--window-max` など）
- `logging` による統一ログ出力（UTC + JST）
- `.env` による環境変数管理

---

## インストール手順

```bash
# 仮想環境の作成（推奨）
python3 -m venv venv
source venv/bin/activate  # Windows は venv\\Scripts\\activate

# 依存パッケージのインストール
pip install -r requirements.txt
```

---

## 設定方法
`.env` ファイルに以下の内容を設定してください。

```bash
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+81xxxxxxxxxx
TWILIO_TO_NUMBER=+81yyyyyyyyyy
GOOGLE_CALENDAR_ID=primary
TZ=Asia/Tokyo
```

初回実行時に `credentials.json` を同ディレクトリに配置し、Google 認証を行う必要があります。
成功すると `token.json` が自動生成されます。

---
了解です。以下は **Google Calendar API の設定手順** を日本語で整理したものです。
これを一度設定すれば、以降は自動で Google カレンダーを読み取れるようになります。

---

### ✅ **Google Calendar API 認証設定手順**

1. **Google Cloud Console にアクセス**
   [Google Cloud Console](https://console.cloud.google.com/) を開きます。
   初めての場合は「プロジェクトを作成」ボタンが表示されます。
   プロジェクト名は自由に設定してください（例：`GcalReminder`）。

2. **Calendar API を有効化**
   画面上部の検索バーに「Google Calendar API」と入力します。
   検索結果から「Google Calendar API」を選択し、**「有効にする（Enable）」** をクリックします。

3. **OAuth 2.0 クライアント ID を作成**
   左側メニューから「API とサービス」→「認証情報（Credentials）」を開きます。
   「+ 認証情報を作成」→「OAuth クライアント ID」を選択します。

   * **アプリケーションの種類**：デスクトップ アプリケーション
   * **名前**：任意（例：`Gcal Reminder`）
     設定後、「作成」をクリックします。
     完了すると `credentials.json` がダウンロードできます。

4. **認証ファイルを配置**
   ダウンロードした `credentials.json` を、
   スクリプト（`gcal_twilio_reminder.py`）と**同じディレクトリ**に置きます。
   ※ ファイル名は **`credentials.json`** のまま変更しないでください。

5. **初回実行で認可を行う**
   ターミナルで次のコマンドを実行します：

   ```bash
   python gcal_twilio_reminder.py --dry-run
   ```

   自動的にブラウザが開き、Google アカウントの選択とアクセス許可を求められます。
   「許可」をクリックすると、同じディレクトリに次のファイルが生成されます：

   ```
   token.json
   ```

   これが認可済みトークンです。次回以降の実行では再認証は不要です。
---

## 実行方法
```bash
# ドライラン（送信せず出力のみ）
python gcal_twilio_reminder.py --dry-run

# 通常実行（Twilio 経由で送信）
python gcal_twilio_reminder.py --window-min 55 --window-max 65
```

その他オプション：
```
--calendar-id     指定カレンダー ID（省略時は primary）
--from-number     Twilio 発信番号
--to-number       送信先番号（省略時は発信番号と同じ）
--db              SQLite DB パス（既定: sent_reminders.sqlite3）
--log-level       INFO / DEBUG / ERROR
--run-tests       内部テスト実行
```

---

## 定期実行設定（cron 例）
```bash
# 毎日 8:00 に当日の予定を通知
0 8 * * *  /path/to/venv/bin/python /path/to/gcal_twilio_reminder.py --dry-run

# 15 分ごとに次の 1 時間以内のイベントをチェック
*/15 * * * * /path/to/venv/bin/python /path/to/gcal_twilio_reminder.py --window-min 55 --window-max 65
```

---

## ライセンス
MIT License

---

## 作者
- **劉 双 (Liu Shuang)**  
  [GitHub](https://github.com/liushuang393)