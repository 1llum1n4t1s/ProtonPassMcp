# リポジトリ作業規約

## 参照と構造

- 利用者向け手順は [README.md](README.md)、開発手順は [CONTRIBUTING.md](CONTRIBUTING.md)、実装の構造と判断は [DESIGN.md](DESIGN.md) を参照する。
- MCP 入力・応答は `src/server.mjs`、理由とフィールド名のスキーマは `src/inputs.mjs`、CLI 呼び出しと検索は `src/pass.mjs` を変更する。変更時は各境界の契約と `test/pass.test.mjs`・`test/inputs.test.mjs` の対応を確認する。
- Node.js 22 以降の JavaScript ESM と pnpm を使う。バージョンと配布設定の正本は `package.json`、依存解決の正本は `pnpm-lock.yaml` とする。

## 必須検証

- 依存を準備するときは `pnpm install --frozen-lockfile` を実行する。
- 実装を変更したときは `pnpm test` を実行し、認証失敗、秘密の出力抑制、検索カーソル、直列実行の契約を維持する。テストデータと CLI runner の差し替えを使って確認する。
- MCP 接続を実セッションで検証するときは、利用可能な `PASS_CLI_PATH` と `PROTON_PASS_SESSION_DIR` を設定して `pnpm verify` を実行する。この検証はアクセス可能な保管庫が1件以上あることを前提とする。
- 配布内容を変更したときは `npm pack --dry-run` で同梱対象を確認する。公開時の `prepublishOnly` は `pnpm test` を実行する。開発コマンドの詳細は CONTRIBUTING を参照する。
- リリース作業では [CONTRIBUTING.md](CONTRIBUTING.md) の公開手順に従い、`.github/workflows/publish.yml` を使う。公開設定を変更するときは、ブランチ名と manifest バージョンの一致検証、公開前テスト、OIDC 認証を維持する。

## 実装上の制約

- ツール追加・変更時は strict な入力スキーマ、読み取り専用の CLI 操作、ツール単位の直列実行を維持する。
- CLI 実行は `runCli` を経由し、引数配列と `shell: false`、タイムアウト、出力上限、キャンセル伝播を維持する。
- 一覧と検索結果は許可したメタデータだけを返し、秘密値が必要な取得は理由付きの `read_field` を使う。CLI の生エラーは分類した `PassError` に置き換える。
- 認証は既存セッションを参照する。子プロセス環境から PAT と継承された理由を除き、必要な呼び出しだけに今回の理由を渡す。
- 利用方法の変更は README、構造・不変条件の変更は DESIGN、作業手順の変更は本書または CONTRIBUTING の該当箇所へ反映する。
