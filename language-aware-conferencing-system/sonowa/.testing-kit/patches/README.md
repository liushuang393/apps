# 起動待ち契約の互換修正

この作業コピーで復旧したTesting Kit 0.3.0の `scripts/certify_project.py` は、
`server_start.timeout_seconds` に関係なくidentityを30秒だけ待っていた。
Sonowaの取得済みローカルモデルの起動では実機でこの制限に達した。

変更は1行のみ: `_wait_for_identity()` の固定30秒を、スキーマで検証した
`server_start.timeout_seconds` に置き換える。今回の契約値は180秒。
期限超過、所有プロセス終了、HTTP失敗、業務の期待値の扱いは変更しない。
7秒の契約なら7秒で失敗し、30秒の契約で45秒後の起動を合格にしない。

| ファイル内容 | SHA-256 |
| --- | --- |
| 配布元から復旧した版 | `135c14a11432132ea793028d4be6d82380f9db8da3b2671dbd52fb433fe6d879` |
| 互換修正後 | `979809de8bc779da6d98ea6a5b8c37e30d0a484ca6af2c57c0178171cbf20b6a` |

再インストール後の再現手順:

```bash
python3 e2e/scripts/apply_kit_startup_patch.py
.venv-testing-kit/bin/python e2e/tests/test_kit_startup_deadline.py
```

適用スクリプトは、このプロジェクト内のvenvと上記2ハッシュだけを受理する。
上流の別バージョンへ自動適用しない。他リポジトリのKitソースも変更しない。
遅い正常起動と短い上限が修正前に失敗し、修正後に成功することを確認した。
所有プロセスが起動前・HTTP成功直後に終了する場合も拒否する5テストを保持する。
未知バージョン拒否・二重適用防止の3テストと、専用プロファイルの配置2テストを加え、計10件が成功している。

この変更後の結果は「互換修正したTesting Kitによる実行」と明示する。
未修正配布物で全段階を通過した証拠や、業務品質の合格を意味しない。
