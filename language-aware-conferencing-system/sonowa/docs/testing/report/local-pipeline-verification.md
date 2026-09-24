# ローカル音声翻訳の実機検証記録（進行中）

判定: **公開未完了・検証継続**。最終目標は小型モデル2個以内での音声認識、翻訳テキスト、翻訳音声。3モデルの起動を完了条件にはしない。

**作業範囲の変更（ユーザー指示）:** レビュー・テストで再現した実装バグの修正だけを対象とする。記録済みの実装不具合は修正済み。モデル探索・追加比較・全業務認証への範囲拡大は停止する。既存の820成功・4条件付きスキップと品質ゲートの証拠を維持し、未解決の発音品質や未完了の総合検証を合格へ変更しない。以下の「次の作業」「比較中」は従前の経緯であり、追加作業の指示ではない。

最後の語彙展開比較は48音声とWhisper観測まで完了した。元の失敗文ではWhisperの対象語不一致が3シード中2件残り、未使用の欠損否定文では両ASRとも対象語が不一致だったため、製品へ反映しない。証拠は `output/local-pipeline/omnivoice-fidelity/lexical/`。通常backendは復帰後に `/health` HTTP 200を確認済み。

## 現在の環境

- RTX 3060 12GB。Docker は Windows PowerShell から `INSTALL_LOCAL=1` と GPU override を使いビルド・起動。
- 検証用 URL: `http://localhost:5273`（HTTP 200）、`http://localhost:8090/health`（HTTP 200）。公開完了を意味しない。
- PostgreSQL の Alembic は `016_experiment_metric (head)`。既存 DB と `sonowa_models` を保持。
- 管理 API 経由で ASR/MT/TTS=`local`、hybrid、partial OFF、LLM 補正 OFF を保存。設定試験の作成ユーザーは削除済み。`output/local-pipeline/local-settings.json`。
- 現在のイメージは `sonowa-backend:local-small` / `sha256:57d9888ca18b7835b31b5e20ff0972ce77c2675afe22c53230bf93c2abdae7b8`。Gemma ASR/MT + OmniVoice TTS の2モデル、VRAM予算10000MiB。GPU と local-small の追加 Compose を使う。OmniVoice の重みは非商用ライセンス。
- 全バックエンド820成功・4条件付きスキップ、品質チェック成功。スレッド例外をエラー扱いにした全体試験が成功（残る15警告は非推奨API等）。製品のGPU証拠は `output/local-pipeline/omnivoice-generation/`、追加のDB検証は `testing-kit-owned-db/`、専用Dockerの部分E2Eは `testing-kit-owned-runtime/`、最新の正式契約検証は `testing-kit-contract/`（いずれも `output/local-pipeline/` 配下）。以下には失敗を含む過去の比較経緯も保持する。

## 最新: 発音パラメータの追加比較と単一モデル候補

OmniVoiceの位置選択温度3条件（36音声）、速度・無音除去・末尾フェード4条件（48音声）を追加比較した。失敗した原文を変えず、既存と同じ4文章・seed 0/1/2を使用。全84音声をGemmaとWhisperで観測し、WAVと両観測のSHAを照合した。証拠は `output/local-pipeline/omnivoice-fidelity/positions/` と `timing/`。診断用イメージ `b33a79ea`、ネットワークなし、モデルボリュームは読み取り専用。最大Torch割当はそれぞれ9105.05、9151.95MiBだった。

元の失敗文に対する3シードの文字列観測（発音正答率ではない）:

| 条件 | Gemmaにtệpがある | Whisperにtệpがある | 両方にある |
| --- | ---: | ---: | ---: |
| position_temperature=0 | 0/3 | 0/3 | 0/3 |
| position_temperature=1 | 1/3 | 0/3 | 0/3 |
| position_temperature=2 | 2/3 | 0/3 | 0/3 |
| speed=0.8 | 2/3 | 1/3 | 1/3 |
| speed=0.6 | 1/3 | 0/3 | 0/3 |
| 無音除去なし | 2/3 | 1/3 | 1/3 |
| 末尾フェードなし | 2/3 | 1/3 | 1/3 |

どの条件も全シードで問題語を保持せず、製品既定への変更根拠は得られなかった。言語コード `vi` は実装の対応表に存在し、言語指定が無視されたという仮説も該当しない。

次の診断候補は [SeamlessM4T Medium](https://huggingface.co/facebook/hf-seamless-m4t-medium)。公式の統合モデルは音声認識、音声/テキスト翻訳、翻訳音声生成を扱い、[生成設定](https://huggingface.co/facebook/hf-seamless-m4t-medium/blob/main/generation_config.json)では jpn/eng/cmn/vie がテキスト・音声出力の対象。CC-BY-NC 4.0であり、現在のOmniVoice同様、商用利用可能性の証明にはしない。revision `ecf60d4df63baaac3f82ae6a7ad7adcb19dcb26c` の10ファイルを永続キャッシュに取得し、公式 `hf cache verify --fail-on-missing-files` が全チェックサム一致で終了した。

`scripts/probe_local_seamless.py` は既存の4言語入力・自然録音を使い、認識8件、音声翻訳12方向、テキストからの音声生成2件を通信遮断下で比較する診断ハーネス。製品には未統合であり、完走だけを品質合格にしない。

実測パラメータ数は1,209,461,122。初回は音声長の0次元Tensorを添字で読むハーネスの誤りで停止した（`baseline/` に失敗を保持）。スカラー・1要素・不正長の3回帰テストを先に失敗させ、範囲検査を伴う抽出へ修正して全件成功した。製品バックエンドのテスト数とは別集計。

| 条件 | 認識 | 翻訳音声＋テキスト入力音声 | 12方向の生成時間 | Torch最大割当 |
| --- | ---: | ---: | ---: | ---: |
| FP16 | 8件 | 12＋2件 | 0.748〜1.794秒 | 2585.86MiB |
| FP32 | 8件 | 12＋2件 | 0.696〜1.689秒 | 4976.77MiB |

両方とも完走し、全28音声を別プロセスのWhisperで再認識、レポートとWAVのSHAを照合した。証拠は `output/local-pipeline/seamless-medium/scalar-length/` と `float32/`。両精度の翻訳文は全件同一で、日本語の認識では後半の「ファイルを送信しないでください」が欠落。ja→enでは逆に時刻が欠落し、zh→jaは中国語が混ざり、vi→zhは10時が10時間へ変化した。複数音声の再認識でも内容の不一致があり、精度をFP32へ上げても解消しなかった。**この固定モデル・設定は単独構成として不採用**。低遅延・省VRAMを意味保持の代替にしない。

続くOmniVoiceの診断では、入力原文を保持したまま音声化テキスト中の `tệp` / `tệp tin` を `tập tin` に展開する条件を対照群と比較する。既存4文に、数量、削除禁止、保存先、欠損否定を含む未使用4文を加え、各3シード・計48音声を事前に固定。`translation` は元の文、`normalized` は実際に音声化した文として区別し、成功シードだけを採用しない。これは発音用の語彙展開の実験であり、製品への変更ではない。

## 宣言済み起動上限・4権限の画面探索

Testing Kitの固定30秒待機を、既に契約にある `server_start.timeout_seconds` に従うよう1行修正した。180秒契約で45秒後の正常起動を受理し、7秒契約を30秒へ延ばさず、期限超過とプロセス終了を拒否する回帰テストで確認した。変更対象はこの作業コピー内のvenvだけで、[適用ハッシュと再現手順](../../../.testing-kit/patches/README.md) を保持。未知の配布バージョンへは自動適用しない。

専用プロファイルのソース一覧配置と認証状態配置も修正。前者は36 API・16画面・3ロールをそのまま専用ディレクトリへ抽出し、後者は正規ログインの状態を `e2e/certification/.auth/` へ生成してGit管理から除外する。開始3画面だけをソース母数にしていた暗黙の縮退を除いた。

**互換修正したKitによる認証は7/18段階成功**。新たに `runtime_identity_and_discovery` が通過し、14静的画面を匿名/admin/moderator/userで計56回観測した。停止箇所は `source_runtime_reconciliation`。残る高優先度の未照合は `/room/:roomId` と `/room/:roomId/transcript` の2件で、実在する会議室と状態を用意した観測が必要。操作数上限による未探索も18件あり、UIが見えただけで全業務を合格にしていない。

- 証拠: `output/local-pipeline/testing-kit-contract/declared-budget-with-discovery/certification.json`。未修正配布物で全段階が通った証拠とは区別する。
- 個別探索後のDB実観測: ユーザー3件・会議室0件、migration head・所有者一致。`discovery-read-only-state.json`。
- 認証のcleanup restoreは成功。再確認した `declared-budget-cleanup.json` も成功し、専用コンテナ・ネットワークを削除して通常backendを再起動。
- 追加のKit契約テスト10件、品質ゲート、E2E TypeScript strict、Ruff/formatが成功。製品バックエンド820成功の証拠は維持し、追加10件を混ぜて製品テスト数を水増ししない。

公開未完了は継続。次は動的2画面の実状態と業務シナリオを結び付ける。音声品質では、固定したOmniVoice実装の未検証パラメータ `position_temperature`（既定5.0、トークン自体の `class_temperature` は既定0.0）が位置選択に乱数を加えることを確認した。調整は新たな比較候補であり、現時点で製品設定を変更・品質改善を宣言していない。

## TTS音声の第2観測

Whisper mediumだけの評価誤りかを切り分けるため、`scripts/verify_candidate_audio.py --observer gemma` を追加した。選択したASRだけを呼び、正解文を認識に渡さない回帰テストを先に失敗させてから実装した。GemmaはOmniVoice TTSとは独立しているが、製品ASR/MTと同系列であり、翻訳の独立評価とは扱わない。

製品イメージ57d9888c、`--network none`、読み取り専用モデルキャッシュで、既存の12方向音声と84条件の比較音声をすべて再認識した。新たな音声を都合よく生成し直していない。**96件完了・空認識なし**、元レポートと両観測レポートのSHA、全WAVのSHAを照合した。証拠は `output/local-pipeline/omnivoice-fidelity/second-observer-summary.json` と各ディレクトリの `gemma-audio-observation.json`。

製品en→viの期待文は `Cuộc họp bắt đầu lúc 10. Không gửi tệp`。Gemmaの観測は `Cuộc họp bắt đầu lúc 10:00 không gửi tiếp` で、「ファイル」を表す語を保持しなかった。Whisperの誤認識だけとは判断できない。他の11方向はGemmaの書き起こしで時刻・否定・対象語を確認できたが、これを母語話者による発音評価や一般品質保証へ拡張しない。

変更前の問題文をそのまま使った各3シードの観測:

| 条件 | Gemmaにtệpがある | Whisperにtệpがある | 両方にある |
| --- | ---: | ---: | ---: |
| baseline | 2/3 | 1/3 | 1/3 |
| 数字の文字化 | 1/3 | 0/3 | 0/3 |
| guidance変更 | 1/3 | 1/3 | 1/3 |
| 声質指定 | 2/3 | 0/3 | 0/3 |
| 64ステップ | 2/3 | 0/3 | 0/3 |
| 参照録音 | 2/3 | 0/3 | 0/3 |
| 参照録音＋64ステップ | 0/3 | 0/3 | 0/3 |

この表は特定語の文字列出現の観測であり、発音正答率ではない。成功したシードを後から製品既定に選んだり、元の失敗文を除外したりしない。条件変更による安定した改善は未確認のため、製品設定・モデル数・イメージは変更していない。今後の修正には、別コーパスを含む再現可能な改善と音声内容の評価が必要。

最新全体試験は820成功・4条件付きスキップ・15警告（41.26秒）、`./scripts/check.sh` と追加ファイルのRuff/formatも成功。評価用コンテナは終了コード0を確認し、通常backendを再起動した。

## ソース抽出修正・正式契約への初回接続

`e2e/scripts/extract.py` が別リポジトリのロール定義を参照し、未登録ルート・仮想環境まで走査していた。失敗テストを追加して、実際の `app.main` のルーター登録をASTで追跡する方式へ修正した。登録prefixを合成し、未登録モジュールを除外する。実FastAPIのルート集合との照合を含む7テストが成功。**36 APIルート・16画面・3ロール**を抽出し、全件を業務パターン台帳の未完了範囲に含めた。

共有環境向けの既存設定を保持し、`e2e/certification/app.toml` と `app-owned-runtime.json` を追加した。専用PostgreSQLの実reset/snapshot/restore、正規ログイン、前景Docker管理、Playwright証拠レポーターを接続。契約3ファイルの公式スキーマ検証と4ケースのソース行・証拠ステップ照合は成功した。Node.js型定義は `e2e/package.json` に分離し、製品フロントエンドの型解決に混入させない。

正式ランナーの結果は **6/18段階成功、公開未完了**。

- 成功: portable preflight、adapter、設定、ソース抽出、実フロントエンドbuild、専用DB lifecycle。
- 停止: `runtime_identity_and_discovery`。カーネルの固定30秒（実測30.099秒）で起動確認がタイムアウトした。その後、同じ実アプリのidentity APIはHTTP 200となった。モデル準備を省略したり、別のヘルス応答で合格を代替したりしていない。
- 証拠: `output/local-pipeline/testing-kit-contract/strict-isolated-types/certification.json`。以前の2/18、今回のCLI指定誤り・型定義混入による失敗結果も別ディレクトリに保持。
- 新しい証拠ステップ名・レポーターでのブラウザ実行は、この正式試行では未到達。前回の4ケース×2ラウンド成功を最新ソースの正式認証へ流用しない。台帳10パターンはすべて `blocked` のまま。

タイムアウト後に検証サービスが残る問題も実機で確認した。モデル起動待ちに終了イベントを渡し、Compose作成途中の空NetworkIDは所有確認済みネットワーク名で照合するよう修正。別所有者・異なるネットワーク・稼働中の空IDは拒否を維持する。6件の追加テストと、実Docker起動途中のSIGTERM試験が成功し、**2.332秒で終了・残存サービス0件**となった。`startup-cancellation.json` に結果を保存した。

最新の全体試験は `cd backend && .venv/bin/python -m pytest tests -q -W error::pytest.PytestUnhandledThreadExceptionWarning` で **818 passed, 4 skipped, 15 warnings**。`./scripts/check.sh`、追加PythonのRuff/format、E2E TypeScript strict検査も成功。製品ソース・イメージ・envファイルはこの追加作業で変更していない。専用DBは実restore後に所有資源ごと削除し、通常のbackendを再起動した。

再開時は [専用認証の手順](../../../e2e/certification/README.md) を使用する。残件は起動待ち時間を扱う正式契約、全業務範囲のwalkthroughと実行証拠、コピー隔離、ベトナム語音声の品質。固定30秒制限は今回初めて実行上の停止理由として確認したもので、モデル故障とは断定しない。

## 修復済みと観測

1. local ステージ欠損時のクラウド自動切替を除去。TTS 欠損は字幕継続。テキスト翻訳 API の local 選択もクラウドキャッシュ/MT を経由しない。
2. CTranslate2 に必要な CUDA 12 ライブラリ不足を確認し、torch/torchaudio 2.9.1 とライブラリパスを修正。pip の大容量取得失敗に対し pip 26.2.1 と BuildKit キャッシュを使用。
3. MADLAD 変換を FP16 読み込みにしてホストのスワップ過多を解消。不完全な変換結果を検出。3モデルとトークナイザの永続取得を実施。
4. VoxCPM2 のコンパイルワーカー異常を再現し、`optimize=False` を使用。通信遮断下で4言語の非空・非無音 WAV を生成。
5. VRAM Broker が高優先度の未使用 ASR を保持し続けて TTS をロードできない問題を修正。使用中モデルは保護。
6. ASR が48kHz WAVを16kHzとして認識する問題を再現テスト後に修正。
7. 既存 Processor テストのフェイクを現在の TransportAdapter 契約に合わせて修正。
8. ASR/MT を単一 Gemma エンジンへ統合。標準モデル準備を Gemma/VoxCPM2 の2モデルに変更し、旧3モデルは明示オプションに限定。
9. 並行推論をモデル単位で直列化。推論中・ロード中のキャンセルを実ワーカー終了まで遅延し、GPU モデルが管理外になる問題を回帰テスト後に修正。
10. local 指定を A/B 実験がクラウド候補へ置き換える経路を遮断。全 local hybrid の未使用クラウド資格警告も修正。
11. LiveKit の通知 IP が旧 Windows IP `192.168.210.6` のままだったため、プロセス環境の `HOST_IP=192.168.210.27` でサービスを再作成。`.env` は変更していない。
12. LiveKit の字幕・音声主線が並行すると、字幕のモデル参照が残るため TTS が即座に容量エラーになる問題を実機で確認。Broker に解放通知と上限付き待機を追加し、local ASR/MT/TTS が最大120秒待つよう修正。使用中モデルは退避せず、待機が期限を超えた場合のみ明示エラーへ縮退。関連37テスト成功、実機再確認は継続中。

## 2モデル化の選定

候補は [Gemma 4 E2B IT](https://huggingface.co/google/gemma-4-E2B-it)（ASR/MT共有）と VoxCPM2（TTS）。Gemma は Apache 2.0、実効2.3B・総5.1B。revision `3e22461f65e89153144f8adb70e3b8c2cc9845a7` を取得済み。

- NF4 のテキスト翻訳は12方向で応答し、数字・否定・会議開始時刻の意味を確認。ただし簡単な1文セットであり、一般品質の保証ではない。
- 最初の音声認識は失敗。BF16 の日本語試験では既知文を完全に認識した。
- 原因調査で、bitsandbytes の除外キー `audio_tower` では配下の線形層が除外されないことを確認。`model.audio_tower` 等の完全な階層名へ修正し、音声側の Linear4bit が0件であることを検査する。
- TorchCodec 0.16 と torch 2.9 の非互換も検出。WAV のプローブは librosa を明示し、最終依存に互換 TorchCodec 0.9.1 を指定。[公式互換表](https://github.com/meta-pytorch/torchcodec)
- 修正した音声側 BF16 / テキスト側 NF4 で4言語自然発話を認識。日本語「敵対的」等の誤認識が残る。音声入力が実際に音声 tower を通ること、音声 tower の4bit層が0であることを記録。
- 自然発話プローブのモデルロード13.984秒、認識は日本語17.891秒、英語3.512秒、中国語2.594秒、ベトナム語2.958秒。Torch最大割当7169.71MiB。`output/local-pipeline/natural/gemma-asr.json`。
- 共有 ASR/MT と並行制御は組み込み済み。通信遮断した連結実験で Gemma の解放→VoxCPM2 ロードを確認。最終イメージによる検証は継続中。

## テスト結果

- 修正後の `cd backend && .venv/bin/python -m pytest tests -q --tb=short`: **752 passed, 4 skipped, 15 warnings**（64.95秒）。2件は明示許可が必要な既存クラウド統合試験、残りは Google SDK 条件。これをローカル E2E の合格とは扱わない。1つ前の実行では aiosqlite の終了時スレッド警告1件あり、最新全体実行では再現しなかった。
- `./scripts/check.sh`: backend Ruff/format/構文、frontend ESLint/TypeScript 全て成功。
- 空音声・無音拒否、モデル欠損時の非クラウド動作、VRAM参照保護、モデル準備の不完全結果、TTS設定、48kHz正規化の回帰テストを追加。
- Testing Kit 0.3.0 を既存の指定配布元由来 venv から復旧。`ai-guide`、`ai-install --check` を実施。certification は preflight/adapter の2段階のみ成功し、Playwright 設定不足で停止。総合認証は未合格。

## 音声素材と遅延（比較用）

VoxCPM2 がローカル生成した既知文は `output/local-pipeline/input-{ja,en,zh,vi}.wav`。初回日本語ロード込み239.6秒、後続の英語17.2秒、中国語8.5秒、ベトナム語19.7秒。旧torchイメージでの測定のため最終性能値ではない。

Whisper比較試験は48kHz修正後、日本語・英語が高一致、中国語は繁体字と漢数字のため文字一致基準を下回り、ベトナム語は誤認識あり。文字一致の閾値だけでは品質合格にしない。

[Google FLEURS](https://huggingface.co/datasets/google/fleurs)（CC-BY-4.0）の4言語の自然発話を取得し、原文・出典・ID・WAVハッシュを `output/local-pipeline/natural/manifest.json` に保存。日本語10.44秒、英語10.56秒、中国語10.38秒、ベトナム語11.34秒。

## 試験手順上の逸脱

Docker起動後の全テスト実行で、既存 `tests/integration/test_livekit_two_clients.py` の OpenAI 音声生成と直接パイプライン試験が動作した。ローカルのみという条件に反するため、この実行結果を合格証拠から除外する。利用者へ説明済み。

再発防止として、同テストは `SONOWA_RUN_CLOUD_TESTS=1` と APIキーの両方がある場合だけ動くよう変更し、キーだけでは動かない回帰テストを追加した。ローカルの実モデル試験は通信遮断コンテナで独立実施する。

この既存 LiveKit テストは WSL クライアントの `wait_pc_connection timed out` で失敗。ローカル専用ハーネスによる2クライアントの字幕/音声/DB照合は未完了。既存統合試験が作成したテストレコードの確認・限定削除も残っている。

追記: 当日作成の `翻訳テスト-971503a5` と対応する2ユーザーだけを特定し削除済み。9月12日以前の同種テストデータは保持。途中停止した接続プローブの当日3ユーザー/部屋も限定削除済み。IP更新後の接続専用試験は2クライアント接続・切断に成功し、後片付け済み（`output/local-pipeline/livekit-connect-only/livekit.json`）。音声 E2E の合格ではない。

## 現在の2モデル連結実測

`sonowa-gemma-probe:local`、`--network none`、モデル永続ボリューム read-only で実行中。4言語の入力音声再生成は初回日本語39.924秒、英語7.081秒、中国語5.362秒、ベトナム語5.972秒。Torch最大5459.06MiB。`output/local-pipeline/two-models/tts.json`。

12方向連結が終了し、全方向で非空・非無音 WAV を生成。`output/local-pipeline/two-models/pipeline.json`。初回 ja→en 85.770秒、ja→zh 90.743秒、ja→vi 85.570秒。全体85.570〜285.192秒、Torch最大7150.13MiB、GPU全体サンプリング最大8617MiB。ビルドとの並行と診断コンテナのRAM制限があるため、最終単独性能値ではない。

**意味保持は不合格**: ベトナム語入力 `Cuộc họp bắt đầu lúc 10 giờ. Đừng gửi tệp.` を `Được hợp bắt đầu lúc 10 giờ. Đừng gửi tệp` と認識。日本語訳 `10時から開始できます。ファイルを送らないでください。`、英訳 `Can start at 10 o'clock. Don't send the file` となり「会議」が失われる。JSON の `passed` は技術的完走のみであり、公開合格ではない。VoxCPM2 の発音と Gemma ASR の誤認識を切り分け中。

LiveKit 実試験 `output/local-pipeline/final-livekit/livekit.json` では、2クライアント接続後、`The meeting starts at 10 o'clock.` と `Do not send the file.` の字幕を受信。音声0バイトで失敗し、試験データの後片付けは成功。サーバーの TTS 容量エラーを上記12の修正対象とした。

モデル未配置・通信遮断の実 Docker 試験 `output/local-pipeline/missing-models.json` は成功。ASR/MT は空結果、TTS は音声なし。1MiB の予算不足でも GPU ロードせず同様に縮退し、外部通信・クラウド代替は使わない。

### ベトナム語の切り分け

- 同じ失敗 WAV を Gemma BF16 で認識しても `được hợp bắt đầu lúc 10 giờ đừng gửi tệp`。NF4 特有の問題ではない。Torch最大9763.85MiB。`two-models/gemma-asr.json`。
- 既存 Whisper Medium は同じ WAV を `Cái cuộc họp bắt đầu lúc 10 giờ. Đừng gửi tẹp.` と認識した。会議の語は保持するが末尾の発音/表記に誤りが残る。比較専用であり、本番へ3モデル目を追加していない。`voice-diagnostic/input-comparison.json`。
- 同じ乱数 seed 0 で VoxCPM2 の参照なし・声参照・文脈参照を比較。参照なしの1例は Gemma が正しく認識した一方、参照付きは `Quạc hợp` / `cộng hợp` と誤認識。参照付き採用による安定改善は認められず、製品設定は変更していない。`voice-diagnostic/comparison.json`。
- 乱数を成功例に固定することや、失敗した入力素材を差し替えることで合格扱いにはしない。

### 修正版 LiveKit と再起動検証

イメージ `sha256:a3544b0bdccffb77f372f5aaa275912b9f4b80cd383f958ef9592c766e19e489` に VRAM 待機修正を反映。CUDA / torch 2.9.1+cu128 / Transformers 5.17.0 / TorchCodec 0.9.1 を確認。VAD=`energy`、話者分離 OFF で、補助の認識モデルは本番ロードしない。

- 初回 `capacity-fixed-livekit/livekit.json`: 字幕と非無音の英語音声を受信（227.052秒）。この時点のハーネスは最初の文で終了していたため、文全体の合格ではない。`tested_image` が複数IDとなる証拠収集の問題も修正した。
- 再起動後 `restarted-livekit/livekit.json`: PUT前のGETで全local/hybrid/補正OFFの保持を確認。2文の字幕とDB内容が一致し、非無音WAVを受信（107.864秒）。作成した3ユーザーと部屋を削除済み。
- **受信内容の追加検証で不合格**: `restarted-livekit/received-audio.json` は元WAVのハッシュと区間位置を保持して音声を認識。実音声は最初の `The meeting starts at 10:00.` のみ。否定文の音声がないため、前段の `passed` を最終E2E合格として使用しない。
- 現行の hearing P95 目標は5秒。ローカルモデル切替が超過し、QoEが後続音声を字幕へ縮退させる経路を確認。基準を単に緩めて合格扱いにはしない。低遅延優先か、遅延を許容して全文音声を待つかの希望を照会中。

比較評価用に `facebook/hf-seamless-m4t-medium@ecf60d4df63baaac3f82ae6a7ad7adcb19dcb26c` を取得済み。1モデルのASR/翻訳/音声生成を同じ素材で評価する。CC-BY-NC-4.0のため、製品のプロバイダーや管理設定は切り替えていない。[公式カード](https://huggingface.co/facebook/hf-seamless-m4t-medium)。

### 1モデル候補の比較結果

すべて同じ4言語の入力素材、永続モデルボリューム read-only、`--network none` で評価した。下表の処理時間はモデルロードを含まない翻訳・音声生成区間であり、ASR、LiveKit、再生を含む遅延ではない。

| 候補・経路 | 12方向の処理時間 | Torch最大割当 | 品質判定 |
| --- | --- | --- | --- |
| SeamlessM4T Medium、直接音声翻訳 | 約0.97〜2.34秒 | 4115.94MiB | 不合格。日本語前半や否定文が欠落 |
| SeamlessM4T v2、直接音声翻訳 | 0.933〜1.295秒 | 4547.09MiB | 不合格。ja→enで会議文、ja→viで否定文が欠落 |
| SeamlessM4T v2、ASRテキスト経由 | 0.845〜1.184秒 | 4524.61MiB | 不合格。zh→jaで「会議は十時に始まってください文件送らない」等の意味・表現崩れ |

v2 は `facebook/seamless-m4t-v2-large@5f8cc790b19fc3f67a61c105133b20b34e3dcb76`。モデルロード16.270秒（直接）、14.195秒（テキスト経由）。[公式カード](https://huggingface.co/facebook/seamless-m4t-v2-large)のライセンスも CC-BY-NC-4.0。非商用条件と品質の両面から本番へは採用していない。出力音声の全内容照合も未完了。

証拠: `output/local-pipeline/seamless/seamless.json`、`seamless-v2/seamless.json`、`seamless-v2-text/seamless.json`。`execution_complete` は処理完走だけを示し、品質合格ではない。

### 最終イメージの異常系と画面

- `final-runtime.json`: 実GPUで並行する2件のMTが同一Gemmaを使用。テキスト入力からの翻訳後にTTSモデル欠損が発生しても訳文を保持。1MiB予算不足でASR/TTSはロードせず縮退。通信遮断下で成功、Torch最大7106.92MiB。
- `final-missing-models.json`: モデルボリュームを付けず通信遮断。ASR/MTは空結果、TTSは音声なしで終了し、Torch最大0MiB。クラウド代替なし。
- Playwright CLIで `http://127.0.0.1:5273/login` の入力欄・言語選択・ログインボタンを確認。ブラウザーのエラー出力なし。スクリーンショットは `output/playwright/sonowa-login.png`。ログイン後の会議機能の合格証拠とは区別する。
- Testing Kitの初回ブラウザー探索失敗は、そのバージョンが要求するChromium実行ファイル不足。`npx playwright install chromium` 後の公式 `browser-discover` は観測YAMLを生成した。総合certificationの未完了を解消するものではない。
- カタログ `model_registry.py` には旧Whisper/MADLADのlocalカードが残る。実行時のlocal解決はGemmaであり、A/Bは無効・local選択の上書きも遮断しているが、管理カタログの表示整合性は公開前の残件。
- 最終イメージのテキスト入力正常系は ja→en の1件を通信遮断下で実行。`The meeting starts at 10 o'clock. Do not send the files.` と4.16秒の非無音48kHz WAVを生成。ロード込み56.108秒、Torch最大7098.79MiB。`output/local-pipeline/final-text/text-pipeline.json`。生成音声の意味照合は未完了。
- 追加スクリプト5件のRuff/format確認は成功。リポジトリ既存のCRLFを保持し、`git -c core.whitespace=cr-at-eol diff --check` は成功。通常の `git diff --check` は既存と同じCRLFを末尾空白として報告する。
- 最終イメージ・通信遮断下で既存12方向の生成WAVを再認識した。`two-models/roundtrip.json`。全件で認識テキストは得られたが、vi入力由来の3方向は既知の「会議」欠落を再確認。ja→viは `Cook-off sẽ bắt đầu lúc 10 giờ. Không gửi đề`、en→viは `Khớp bắt đầu lúc 10 không gửi tiếp` となり、音声の意味保持を確認できない。TTSと再認識のどちらに起因するかは未確定であり、音声品質合格にはしない。Torch最大7150.83MiB、GPU全体サンプリング最大8399MiB。

## 残りの完了条件

### 追加比較: Seamless音声処理 + MADLAD翻訳

SeamlessM4T v2をASR/TTS、MADLAD-400 3BをMTとして使う2モデル構成を、取得済みモデルだけで比較。両モデルの同時ロードは完了したが、既存CT2モデルの訳文が無関係な反復文になり不合格。`seamless-madlad/seamless.json`。Seamless単体の翻訳品質とは別の問題として扱う。

- HFトークナイザとCT2語彙の256000件は全ID一致。語彙の単純な並び違いではない。
- Transformers 5.17.0で元MADLADをBF16ロードした12方向も反復文になる。`seamless-madlad/source-mt.json`、Torch最大6108.32MiB。CT2量子化だけの問題ではない。
- ロード時に入力埋め込みと出力射影の結合警告を確認。[上流Issue #48154](https://github.com/huggingface/transformers/issues/48154)のT5埋め込み誤読込と症状が一致する。原因の確定には互換版での同一入力比較が必要。
- 製品イメージの依存を変えず、専用コンテナ内の `/tmp/madlad-transformers` にTransformers 4.57.6を導入して再変換が正常終了。出力は `/models/madlad400-3b-mt-int8-v457`、既存モデルは保持。
- 同じ12方向の再試験では反復文が解消した。`seamless-madlad457/seamless.json`。ASRは初回日本語2.007秒、他0.940〜1.017秒、MT/TTSは1.156〜1.876秒。モデル切替なし、Torch最大4524.57MiB、実行後半72点のGPU全体サンプリング最大9096MiB（全実行期間のピーク保証ではない）。
- ただしja→vi、zh→viではMADLAD訳文自体から否定文が消えるため不合格。原音声にはそれぞれ約1.26秒、0.42秒の文間無音がある。入力を変更せず、300ms以上の無音中央で分割して各区間を翻訳する比較を開始。サンプルの省略がないことを検査し、原入力の区間位置を記録する。結果は `two-model-segment/seamless.json` に保存する。
- 分割比較は4言語×2区間×3翻訳先の24件を完走。訳文の会議文・否定文の欠落は解消した。ASR最大2.065秒、MT/TTS区間0.772〜1.424秒。ただし一部訳文に原文にない「午前」の追加があり、ベトナム語の最初の区間をASRが英語 `The meeting starts at 10 o'clock` と出力する問題もある。意味の保持だけで原語字幕まで合格とはしない。
- 24件の生成音声を比較専用Whisperで再認識し、保存されたWAVハッシュと照合するスクリプト `scripts/verify_candidate_audio.py` を追加。観測モデルは本番の2モデル数に加えない。結果は `two-model-segment/received-content.json`。この試験は生成音声の比較でありLiveKit配信証拠ではない。
- 独立再認識24件も完走したが品質は未合格。中国語の時刻が `春天` / `春点`、ベトナム語の `10 giờ` が `thấy dơ` と再認識される例がある。数字の発音と比較ASRの誤認識を未分離のため、時刻保持の証拠として使わない。否定文は大部分で保持、日本語・英語の観測は概ね元訳文に一致。次は数字を読みへ正規化する処理の効果と、ベトナム語ASRの出力言語を切り分ける。
- この比較のため製品プロバイダーは切り替えていない。変更は診断スクリプトとモデル永続ボリューム内の別変換成果物のみ。既存のGemma/VoxCPM2イメージ、DB、元のMADLAD成果物を保持。

### 数値発音・入力素材の追加切り分け

- `probe_seamless_tts.py` で、保存済み24区間の訳文を指定トークン列に固定して再合成。文字列の書換えがないことを全件検査した。`seamless-fixed-text/`。
- 同じ訳文で診断対象の10だけを言語別の文字表記に変更し比較。ベトナム語の `mười giờ` は3方向とも独立Whisperが `10 giờ` と認識し、数字表記のときの `thấy dơ` は解消した。中国語 `十点` は改善したが、`十时` の例は未改善。`seamless-spelled-text/`。これは既知数値の切り分けで、汎用正規化実装・合格ではない。
- ベトナム語入力のSeamless ASRを5ビームにしても、最初の区間を英語で出力する問題は再現。`seamless-asr-beams/seamless.json`。
- WhisperをASR、SeamlessをMT/TTSとした2モデル比較も24区間を実行。日本語の否定文から無関係な料理文が生成される例と、ベトナム語入力の誤認識・誤訳があり不採用。`whisper-seamless/seamless.json`。
- 人間の録音FLEURSをSeamless ASR + MADLADで12方向評価。ベトナム語ASRは原文とほぼ一致し、英語の25〜30年・中国語の否定も訳文で保持。一方、日本語の「コース」を道筋の意味に訳すなどの問題が残る。`natural-seamless/seamless.json` の初回は `expected_source` が既知合成文のままというハーネスのメタデータ不備があり、参照正本は `natural/manifest.json`。次回実行用に `--manifest` と入力WAVハッシュを追加済み。
- 合成素材は、入力したテキストどおりに発音されている保証がない。Vox由来ベトナム語素材の失敗を一律にASR故障とは断定しない。ただし、その結果を隠したり素材差し替えだけで合格にはしない。
- 学習モデルを追加しないeSpeak NG + 日本語仮名辞書の比較は、英語・中国語で元文に近い再認識となったが、日本語の時刻や動詞、ベトナム語で正しい内容を確認できず不採用。`rule-tts/received-content.json`。製品への反映なし。
- 次の限定比較はGemma ASR/MT + OmniVoice 0.6B TTSの同時常駐。`k2-fsa/OmniVoice@c5fdb5ccb189668d56333f77ba2629f4cd7535f4` を永続キャッシュへ取得中。補助ASRロードを無効化し、付属音声コーデックを含めたVRAMを実測する。[公式モデルカード](https://huggingface.co/k2-fsa/OmniVoice)の重みライセンスはCC-BY-NC。製品設定は未変更。

### Gemma + OmniVoice の有望な2モデル比較

OmniVoice 0.2.1を専用コンテナに導入し、固定revisionの重みと付属音声コーデックを取得済み。ネットワークを切断して試験した。補助Whisperの自動ロードは `load_asr=False`、実行前後の `_asr_pipe is None` も確認。Gemmaを保持したままOmniVoiceをロードし、モデル切替を行わない。

- `gemma-omnivoice/seamless.json`: 既知文を4言語で合成し、Gemma再認識で会議・10時・否定・ファイルを保持。TTS 1.911〜2.670秒、再認識1.509〜2.007秒。Torch最大9102.96MiB、GPU全体の1時点観測10490MiB。初回Gemmaロード＋自然音声認識28.316秒、TTSロード7.650秒。
- `gemma-omnivoice-pipeline/seamless.json`: このTTSで作り、各原語の再認識で確認した入力音声を用い、12方向のASR→MT→TTS→内容観測を実行。全12方向で会議・時刻・否定を保持。連結区間は4.491〜5.941秒、Torch最大9104.41MiB。出力音声の再認識時間は連結区間から除外。モデルロード時間も別計測。
- 残件: en→vi出力音声の再認識で `tệp` / `tiếp` の差、zh→ja訳文で原文にない因果接続 `ので` がある。別のWhisperによる音声照合を `gemma-omnivoice-pipeline/received-content.json` に保存する。文字一致だけで全品質合格にはしない。
- 本比較はステージを直接呼んだ隔離試験。製品のBrokerへOmniVoiceは未登録、LiveKit配信・起動時ウォームアップ・最終イメージでの異常系/再起動は未検証。稼働中製品は引き続きGemma/VoxCPM2であり、OmniVoiceへ切替済みとは報告しない。
- 現設定のVRAM予算はconfig既定7500MiB（`.env`に当該キーなし）。同時常駐の実測はこれを超えるため、製品組込時は実測に基づくGPU compose側の予算設定と容量不足時の回帰検証が必要。`.env`は変更しない。
- 自然な音声を維持できる候補が得られたため、機械音声のeSpeak比較は採用しない。従来Vox生成素材の失敗結果は保持し、その発音の妥当性を未確認として区別する。
- Whisperによる独立12音声照合も終了。全方向で時刻と否定は観測された。en→viのファイル語は `tiệp` と認識され、Gemma観測の `tiếp` と併せて発音確認の残件とする。他の訳文への因果追加も残す。`received-content.json` の完走を最終公開合格にしない。

- ベトナム語の発音/認識の意味破損を解消し、4言語・12方向の品質を再確認。
- 最大2モデルの実ロード記録、数字・否定・意味保持、翻訳音声の内容と非無音を確認。
- 実GPUの並行・VRAM不足・欠損・TTS失敗を検証し、クラウドへ逃げないことを証明。
- LiveKit 2クライアントの受信、DB/サーバー照合、通信遮断、再起動後の再現を確認。
- 最終コードで再ビルド、再テスト、Testing Kit の未合格を解消または明確な未完了として残す。

再開計画: `docs/superpowers/plans/2026-09-20-two-local-models.md`。進行中プローブ: `scripts/probe_local_multimodal.py`。コア/LiveKit検証: `scripts/verify_local_pipeline.py`、`scripts/verify_local_livekit.py`。生の実測JSON/WAVは `output/local-pipeline/`。

### OmniVoice の製品組込とイメージ検証準備

- `LocalOmniVoiceTTSStage` を追加。固定 revision・ローカルキャッシュ限定、付属コーデック必須、補助 ASR 無効、24kHz モノラル WAV、無音/非有限値の拒否、直列実行と Broker 管理を実装した。
- 起動時に Gemma と OmniVoice のロード・初回推論を準備する。必要な合計予算を満たさなければ準備前に失敗する。`docker-compose.local-small.yml` がモデル選択と10000MiBを明示指定し、既定の Vox 設定と `.env` は変更しない。
- ASR/MT のカタログを実際の Gemma に合わせ、選択した TTS の名称・ライセンスを表示する。根拠のない固定性能値を除去した。
- MT に数字・否定・独立文の保持を明示した。同じ12入力の実モデル比較 `gemma-omnivoice-pipeline/mt-fidelity.json` で、zh→ja の余分な「ので」が消えた。ベトナム語のファイル語の発音は残件。
- 回帰試験は767成功、4条件付きスキップ。`./scripts/check.sh` は全項目成功。ログは `/tmp/sonowa-omni-all-tests.log` と `/tmp/sonowa-omni-check.log`。スキップを実機合格には数えない。
- Windows PowerShell から3つの Compose を指定したバックエンド再ビルドを開始。これ以前の稼働イメージは Gemma/Vox のまま。最終イメージの GPU・異常系・LiveKit 全文受信・再起動証拠が揃うまでは公開未完了。

### 最終イメージのオフライン試験

イメージ `sha256:e46871d614553e77fd22fd9a4f43daf26035f0be727459d339998358e8f5350f`。証拠は `output/local-pipeline/omnivoice-final/`。通信なし・モデルボリューム読み取り専用で12方向の認識→翻訳→音声生成が成功し、全ケースで Gemma/OmniVoice の2モデル常駐を記録した。初回ロード込み45.806秒、後続4.976〜6.177秒。Torch最大9090.78MiB、GPU全体250msサンプリング最大10492MiB。文字上は会議・10時・否定を保持。生成音声の内容照合と LiveKit は別判定とする。

同イメージの `empty-cache.json` はモデル全欠損と1MiB予算不足、`runtime.json` は同時MT要求・TTS欠損時の訳文継続・予算不足を成功として記録。ネットワーク遮断下なので外部推論への退避は不可能。ビルド・全体テスト・品質チェックのログも同ディレクトリへ複製済み。

### 全文音声の残件と重複推論の修正

- `omnivoice-final/roundtrip.json` と `independent-audio.json` に12生成音声の観測を保存。英語→ベトナム語の会議語は Gemma と Whisper の観測が異なり、ファイル語も `tệp` / `tiệp` の差が残る。全品質合格とはしない。
- `omnivoice-livekit/livekit.json` で2クライアント・全文字幕・DB照合・後片付けは成功。24.64秒で収集終了。ただし `omnivoice-final/livekit-received-audio.json` は前半だけの音声を観測し不合格。音声12.79秒の大半は無音であり、長さを全文受信の証拠にはしない。
- 字幕と音声の同時MTが同じ原文を2回推論することを回帰試験で再現。同一イベントループ・Broker・モデル・原文の実行中要求だけを共有し、完了後に原文を破棄する修正を追加。取消された主線が他の主線の推論を止めないことも検証。QoSの5秒基準は変更しない。
- Docker の `alembic current` が `app.db` を解決できないことを再現。`alembic.ini` のソース検索パスとスクリプト位置を設定ファイル基準へ修正。`python -m alembic current` によって DB が016のheadであることは確認済み。
- LiveKit ハーネスへ QoS/縮退イベントの記録を追加。重複MT修正後のイメージで再検証するまで、全文音声の問題は未解決のままとする。

### 重複MT修正後の検証イメージ

`sonowa-backend:local-small` は `sha256:392fa4ce853c6fe3726451643ca9e33cc20106184b4d40ad2bf07b30c14414b0`。3ファイルの Compose 構成で起動済み。パッケージ定義が同じ完全ビルド済み依存イメージ `a1dbbd22…` に最新ソースを反映して作成した。手順は `output/local-pipeline/omnivoice-final/Dockerfile.source`、IDと定義ハッシュは `omnivoice-release/provenance.json`。稼働コンテナの MT ソース・alembic.ini・pyproject.toml と作業ツリーのハッシュ一致を確認。通常の再構築は README の3ファイル Compose コマンドでも再現できる。

全バックエンド775成功・4条件付きスキップ、`./scripts/check.sh` 成功。SQLite テストの接続終了時に `Event loop is closed` のスレッド警告2件が出たため、警告なしとは報告しない。これはモデル推論テストの失敗とは分離して残す。直接の `docker exec sonowa-backend-1 alembic current` は正常終了し016 headを確認した。

### 後続音声欠落の根本原因

`LiveKitOutputSink.publish_audio` は、旧世代との一致を確認してから `set_active` していた。共有ゲートが第1文で generation=1 になると、正常な第2文の generation=2 も拒否される。回帰試験で配信列が期待 `[1, 2]` に対して `[1, 1]` になることを再現した（遅延した第1文まで再許可される）。

`GenerationGate.set_active` を単調増加にし、Sinkでは新世代を反映してから照合するよう修正。遅れた旧世代は巻き戻しも配信も拒否する。新規回帰と既存のSink・Adapter・barge-in・Runtime試験36件が成功。遅延の5秒基準は変更していない。修正を反映したイメージで再び全文受信を確認する。

### 最新イメージの確定済み証拠

`omnivoice-generation/` は generation 修正後の `57d9888c…` イメージに対応する。102個の Python ソースを稼働イメージと作業ツリーで照合し、不一致0件。モデル試験はネットワーク `none`、モデルボリューム読み取り専用で実行。

- `pipeline.json`: 4言語・12方向の認識、翻訳、非無音音声が全件生成。モデルロード後5.394〜6.883秒、Torch最大9099.90MiB、GPU全体250msサンプリング最大10434MiB。全ケースで2モデル常駐。
- `independent-audio.json`: 比較専用Whisperで12音声をハッシュ照合して観測。時刻と否定は全方向で確認。en→vi の `tệp` が `tiệm` と観測されるため、ファイル語の発音は品質未合格として残す。比較ASRは本番の2モデルには追加していない。
- `livekit/received-audio.json`: 2クライアント・全文字幕・DB照合・テストデータ清掃に加え、受信音声の「The meeting starts at 10:00」と「Do not send the file」を両方確認し成功。過去の前半のみの失敗を、この修正版で解消した。
- `restarted-livekit/received-audio.json`: バックエンド再起動後、既存の保存設定が local/補正OFF のままであることを確認し、同じ2文の音声受信に再度成功。字幕の到着は入力送信開始から6.726秒・12.664秒。この実行では短い受信フレーム用の音声到着時刻計測が欠けていたため、音声遅延を推測して補わず別の計測実行に分離する。
- `timed-livekit/livekit.json`: 20ms音声フレームの検出を回帰試験後に修正して計測。入力送信開始基準で、字幕7.013秒・13.252秒、最初の音声9.674秒、最後の有声音17.093秒。入力発話時間を含む実クライアントの到着時刻であり、モデル単体の処理時間とは異なる。
- `runtime.json` / `empty-cache.json`: 並行MT、TTS欠損時の字幕継続、全モデル欠損、1MiB予算不足を確認。クラウド退避なし。
- `parallel-runtime-configured.json`: 実配置と同じ10000MiB予算で、日本語→英語と英語→日本語の音声入力を同時処理し、両方の認識・訳文・非無音音声が成功。常駐2モデル、Torch最大9102.39MiB。最初の補助コードは既定7500MiBを使いモデル退避が発生したため不合格となった。実配置設定を読むよう修正して再実行し、誤条件の結果は `parallel-runtime.json` / `parallel-wrong-budget.log` に保持した。
- `text-pipeline.json`: 日本語のテキスト入力から英語訳と3.49秒の非無音音声を生成。音声入力を与えない経路も確認。
- `timed-livekit/received-audio.json` も全文音声の照合に成功。通常試験・再起動後・時刻計測付き試験の3回とも、同じ最終イメージで2文を確認した。
- SQLite のテスト専用接続をイベントループ終了前に閉じるよう修正。`pytest tests -q -W error::pytest.PytestUnhandledThreadExceptionWarning` は777成功・4条件付きスキップ。スレッド例外なし。

### 追加の発音診断と対象台帳

製品イメージ `57d9888c` は変更せず、`scripts/probe_omnivoice_fidelity.py` で同一入力・seed 0/1/2を比較した。通信遮断、モデルボリューム読み取り専用、補助ASRロード禁止を維持。診断用の `sonowa-fidelity-probe` にだけ `num2words==0.5.14` を追加した。製品依存・管理設定・envファイルには反映していない。

- `output/local-pipeline/omnivoice-fidelity/matrix/fidelity.json`: 4文×3 seed×4条件の48件。元の失敗文を維持し、数字正規化、guidance 3.0、声質指定を既定条件と比較。全WAVのハッシュとGemma認識を保存。Torch最大9105.05MiB。
- 同ディレクトリの `independent-audio.json`: Whisper mediumによる48件の独立観測が完了。これは評価専用プロセスであり製品の3モデル目ではない。元の失敗文で `tệp` が一致した観測は既定1/3、数字正規化0/3、guidance 1/3、声質指定0/3。認識誤差を含む観測であり、発音の正解率とは呼ばない。改善が再現したとは判定しない。
- 数字正規化の上流実装は `re.sub(r"\d+", ...)` による整数変換であり、小数・時刻の読みまで保証しない。単一成功例を根拠に製品で有効化しなかった。
- `reference/fidelity.json`: 生成ステップ64、FLEURSのベトナム語参照録音、参照録音＋64ステップの36件。参照録音の原文・SHAを固定し、補助ASRを使わず実行。Torch最大9371.95MiB。追加条件も完走だけで品質合格とはしない。
- `reference/independent-audio.json` も36件の観測が完了。元の失敗文の `tệp` 一致は3条件とも0/3であり、参照録音やステップ増加による改善も確認できなかった。84件の比較は診断完了、発音品質の解決は未完了という判定を維持する。
- 初回の自由文声質指定はOmniVoiceの列挙値制約で失敗した。失敗した `omnivoice-fidelity/fidelity.json` を保持し、正式な列挙値による比較を `matrix/` に分離した。
- 同じWAVが複数条件に現れるため、独立観測はケース順序とSHAの両方で対応付ける。SHAだけを一意キーにして条件数を減らさない。

Testing Kitのソース探索は既定の `apps/` では0件を返した。このOKは採用せず、次の明示的な範囲で再実行した。

```bash
.venv-testing-kit/bin/testing-kit discover-targets --project-root . \
  --apps-root backend --apps-root frontend --strict \
  --output docs/testing/report/repository-target-catalog.json --format summary
```

`tests/e2e/repository-targets.yaml` でbackend/frontendを実Dockerサービスへ対応付け、backend/appはbackendの別名とした。結果はソース3件・分類3件・runtime 2件・ready 0件、`TARGET_E2E_MISSING` がbackend/frontendの2件。既存の `e2e/playwright.config.ts` は存在するが、公式探索が要求する対象ごとのE2E対応付けと厳格認証契約は未整備。総合認証2/18の残件は閉じていない。

復旧済みwheelの `repository-target-overrides.schema.json` は `.venv-testing-kit/testing_kit/schemas/` に配置される一方、Pythonモジュールはsite-packages直下を探索していた。仮想環境内に同一配布物へのシンボリックリンクを作り、`schema is not installed` を解消した。別リポジトリの配布元コードは変更していない。環境を作り直す場合はこの配置も確認する。

追加スクリプトのRuff lint/format、`./scripts/check.sh`、差分の空白チェックは成功。製品コードを変更していないため、この診断を新しい製品イメージの検証とは扱わない。

比較終了後に `sonowa-backend-1` を同じ `sha256:57d9888ca18b7835b31b5e20ff0972ce77c2675afe22c53230bf93c2abdae7b8` で再起動し、`http://localhost:8090/health` と `http://localhost:5273/` のHTTP 200、Alembic `016_experiment_metric (head)` を再確認した。84 WAVのSHA、独立観測側のSHA、元レポートのSHAも全件一致。モデル・DBボリュームは保持し、ローカル検証用の稼働へ戻した。

### Testing Kit用の専用DB復元

共有DBのno-opマーカーを認証証拠にしないため、`e2e/scripts/owned_postgres.py` と実機試験 `scripts/verify_owned_postgres.py` を追加した。専用PostgreSQLは一意な所有ラベル、固定イメージID、loopbackの動的ポート、データディレクトリのtmpfsを使用する。既存のDB・ボリュームをマウントしない。

各操作はコンテナID・所有ラベル・イメージ・DB名・公開ポート・マウント種別を再照合する。`E2E_DB_URL` が完全一致しなければSQL実行前に拒否。snapshotは所有者・コンテナID・SHAで束縛し、別実行や改変データを拒否する。状態・ダンプはGit対象外の `e2e/.runtime/` に保存する。

実機証拠:

- `restore-before.json`: `pg_restore --clean` だけではsnapshot後の追加テーブルが残ったため不合格。行の復元成功だけで閉じなかった。
- `restore-schemas-before.json`: SQLの `LIKE 'pg_%'` がアンダースコアをワイルドカードとして扱い、ユーザースキーマ `pga` を除外する問題を再現。システムスキーマの判定を厳密な接頭辞比較に修正した。
- `restore-schemas.json`: 製品イメージ57d9888cによるAlembic head到達、19テーブル（製品18＋検証用1）、改変ダンプ拒否、別DB URL拒否を確認。2回とも変更行・追加行・追加テーブル・追加ユーザースキーマを復元し、テーブル一覧SHAが一致。スキーマ削除と復元SQLを単一トランザクションで実行する。検証後の専用コンテナ削除も成功。
- 所有権・接続先・古いsnapshot・改変snapshotの18テストが成功。全体は796成功・4条件付きスキップ、共通チェック成功。製品コード・管理設定・envファイルは変更していない。既存バックエンドのhealthはHTTP 200を維持。

再実行はローカルの既存PostgreSQLイメージと製品イメージを使う。次の検証スクリプトは成功・失敗どちらでも、自身が所有するDBコンテナだけを削除する。

```bash
backend/.venv/bin/python e2e/scripts/owned_postgres.py create \
  --postgres-image sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
backend/.venv/bin/python scripts/verify_owned_postgres.py \
  --output output/local-pipeline/testing-kit-owned-db/restore-schemas.json
```

これは厳格認証に使うDB lifecycleの構築・単独実機検証であり、認証18段階の完了ではない。`e2e/app-owned-runtime.json` の既存no-op契約はまだ差し替えていない。次は専用DBを所有するDockerアプリ起動、実ログインのstorage state、Playwrightとcertificationメタデータを一体で結び付ける。全体契約が揃う前に2/18の判定を上書きしない。

### 専用Docker・実ログイン・2回の部分E2E

`docker-compose.certification.yml` と `e2e/scripts/owned_runtime.py` により、専用DBへ接続するbackend/frontend/Redis/LiveKitを用意した。製品と同じバックエンドイメージ57d9888cを使用し、全段階local・補正OFF・Gemma/OmniVoice・10000MiB予算を維持。モデルボリュームは読み取り専用。製品コードや通常のComposeへ認証用APIを追加せず、専用エントリーポイント `certification_app.py` だけを明示マウントした。このプローブは実DBの名前とseed所有者を照合する。

推論サービスはDockerの内部ネットワークだけへ接続した。ホストへの公開には別ネットワークを持つnginx入口を使用し、転送先は固定した内部サービスに限定した。モデルコンテナに2つ目のネットワークが付くとガードが拒否する。実機ではdefault routeが0件、外向きTCP接続は `ENETUNREACH`（101）で拒否された。入口のネットワークを推論サービスの通信許可として扱わない。

実機で見つけた検証コードの問題も保持する:

- snapshotのメタデータが `owned-postgres.json` と衝突し、接続状態を上書きしていた。前回の試験はメモリ上の状態を渡し続けていたため検出できなかった。別コマンドで再読込する回帰テストをREDにしてから、メタデータを `owned-postgres.metadata.json` へ分離。後続のreset/snapshot/start/restore/destroyを別プロセスで実行して確認した。
- 最初の認証用アドレスはログインAPIで422となった。製品の入力検証は変更せず、正規に受理される `cert.sonowa.example.com` 配下の専用アドレスへ修正し、専用DBを再seedした。
- AI設定GETは全認証ユーザーが参照できる仕様だった。管理者境界の試験は、既存の製品テストと同じ管理者専用 `/api/admin/users` に修正。権限仕様や製品APIは変更していない。
- 認証準備が未完了の時点のブラウザー実行は2件失敗・1件成功だった。失敗を合格に含めず、`browser-before.json` に保持した。

現在の証拠は `output/local-pipeline/testing-kit-owned-runtime/`:

- `owned-auth-evidence.json`: admin/moderator/userの3ロールが正規ログイン・`/me`・実DBのroleで一致。管理者専用APIはadmin=200、他2ロール=403。トークンやパスワードを報告へ出力しない。
- `browser-round1.json` / `round1.json`: ロール別画面3件と会議室作成1件が全て成功、skip 0・再試行0。画面/APIで作成した会議室1件を別のDB接続でも確認。
- `restored.json`: サービス停止後の実復元で会議室0件・seedユーザー3件へ戻った。
- `browser-round2.json` / `round2.json`: 再起動・再ログイン後も4件成功。ケース結果・イメージID・DB観測が1回目と一致。両方でモデルコンテナの外部通信拒否を確認。
- `cleanup-restored.json`: 最後の復元も会議室0件・ユーザー3件へ戻った。その後、専用コンテナ・専用ネットワークを全て削除し、専用DB/ランタイムの秘密状態ファイルも削除した。モデルボリュームと通常のDBは保持した。
- Python全体805成功・4条件付きスキップ、関連ガード27成功、共通チェック成功。追加Playwright設定と2つのspecはstrict TypeScriptの型チェックも成功。

通常のバックエンドを再開し、`localhost:8090/health` と `localhost:5273/` のHTTP 200を再確認した。今回の4シナリオは認証と会議室作成の部分E2Eであり、音声品質やTesting Kitの18段階を完了扱いにしない。

総合認証への残件は、専用ランタイムを `app-owned-runtime.json` / `app.toml` へ接続すること、source/business-pattern/scenarioメタデータの整備、全優先業務パターンの証拠、copy isolationである。ソース抽出の `_extract_roles()` が別リポジトリの `apps/common_services/auth_service/...` を参照しており、本アプリの `backend/app/db/models.py` のUserRoleを取り込まない問題も確認した。これを修正せず空のロール台帳で認証を進めない。認証ランナーの30秒起動待ちとGPUウォームアップの整合も、実際の認証実行で確認する必要がある。公式認証の結果は引き続き2/18。

### 再開順序

1. 最新の品質残件は `omnivoice-generation/translated-en-vi.wav` と `independent-audio.json`。原文・訳文・実音声を母語話者の確認を含めて照合し、`tệp` / `tiệm` の差を判定する。`omnivoice-fidelity/matrix/` と `reference/` の84件も参照し、改善を確認できなかった同条件の再試行を繰り返さない。以前の失敗素材を成功例への差し替えで閉じない。
2. 数字・否定・語彙を増やした別の既知コーパスで4言語・12方向を評価する。モデル変更時は最大2モデルと実測VRAMを維持する。OmniVoice重みの非商用条件と、約9.7秒の初回音声到着を利用要件に照らして判断する。
3. Testing Kit は復旧済みだが厳格認証は2/18段階。専用DB・専用Docker・実ログイン・認証/会議室の2回E2Eと最終復元まで完了した。`owned_runtime.py`、`owned_auth_setup.py`、`playwright.certification.config.ts` を正式契約へ接続し、古いrole抽出先と不足メタデータを直す。4シナリオだけで全業務パターンを代替せず、既存DBをno-opマーカーで検証済み扱いにしない。
4. 製品修正後は回帰テスト、`./scripts/check.sh`、3ファイルComposeによる再ビルドを行う。`.env` は変更せず、既存DB/モデルを保持する。
5. 同じ最終イメージで通信遮断の連結/並行/異常系とLiveKit再起動試験を実行する。`transport_complete` だけで完了にせず、`verify_received_audio.py` でWAVハッシュと全文を照合する。
6. 品質残件とTesting Kitの未合格が解消するまで正式公開は保留する。現状のDocker稼働はローカル検証用。

現在の検証イメージを起動する手順（LAN IPは今回の検証値）:

```powershell
$env:INSTALL_LOCAL = "1"
$env:HOST_IP = "192.168.210.27"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.local-small.yml up -d --no-build
docker compose exec backend alembic current
```

## 2026-09-24 方式3（Gemma のみ・字幕のみ）への移行

商用利用可の条件を満たさないため OmniVoice（CC-BY-NC）を削除した。VoxCPM2（Apache-2.0）は Gemma と同時常駐で約12.1GB、交互ロードで1発話あたり約50秒のため不採用。ja/en/zh/vi を1モデルで合成でき、商用可で、Gemma と 12GB に同居できる TTS は見つからなかった（Qwen3-TTS / Fun-CosyVoice3 / Chatterbox はベトナム語非対応）。local TTS は差し替え口（`local_tts.py`、モデル未結線）として残し、方式3 は字幕のみとする。**本記録の上記の `docker-compose.local-small.yml` を使う手順と OmniVoice 前提の判定は無効。**

実機結果（RTX 3060 12GB、入力は FLEURS 自然発話 CC-BY-4.0、合成音声は不使用）:

- `verify_local_pipeline.py --stage asr`: 4言語とも成功（類似度 0.96〜0.99）。VRAM ピーク 7169MiB。
- `--stage pipeline`: 12方向とも成功。1件あたり約5〜7秒（初回ロード時のみ約28秒）。
- VAD: エネルギー VAD は背景雑音（RMS 約0.035 ＞ しきい値 0.015）で ja を 8.0秒 + 2.94秒へ強制切断し、断片から入力にない「お疲れ様です。」を生成した。en / zh は小音量のため区間0件（発話欠落）。Silero では ja 7.1秒の1区間、en / zh / vi も全区間を検出。GPU オーバーライドの既定を `VAD_BACKEND=silero` に変更。
- `verify_local_livekit.py`（字幕のみ、`tts=none`、`default_mode=b`）: ja→en、en→ja、zh→ja、vi→ja の4本とも、2クライアントでの受信・DB 記録との一致・後片付けに成功。字幕到着は発話開始から約5〜18秒（入力発話は約10秒）。
- 残る認識誤り: ja「敵対的」→「適待的」、zh「篇章」→「偏强」（Silero の短い区間で文脈が減った影響の可能性）、zh の短区間が繁体字で出力された例あり。vi「con vật」は正しく認識された。品質の合格判定は保留。
