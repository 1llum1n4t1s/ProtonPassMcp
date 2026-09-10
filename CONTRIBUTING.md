# 開発・検証

Node.js 22以降とpnpmを使います。

```powershell
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` は認証失敗・検索続行・秘密の出力抑制などをダミーデータで確認します。
`PASS_CLI_PATH` と `PROTON_PASS_SESSION_DIR` を認証済みセッションに設定した `pnpm verify` は、実セッションでMCP接続・一覧・入力検証を確認します。
ソースからの起動は同じ環境変数を設定して `pnpm start` を使います。

公開は `.github/workflows/publish.yml` からnpm Trusted Publishing（OIDC）を使います。`package.json` と一致する `release/<version>` ブランチをpushすると、依存解決・配布確認・テストを実行し、未公開のバージョンをnpmへ公開します。再開時は同じブランチを指定してworkflow_dispatchを実行します。初回の手動公開などで公開済みのバージョンは再公開を省略します。

npm側の初回設定は、パッケージのTrusted PublisherにGitHub Actionsを選び、ユーザー `1llum1n4t1s`、リポジトリ `ProtonPassMcp`、Workflow filename `publish.yml` を登録します。Environmentは空欄にし、Allowed actionsで `npm publish` による直接公開を許可します。この登録時は本人認証が必要ですが、以降のCI公開でnpmトークンや対話認証は不要です。

パッケージのバージョンは `package.json` が正本です。ローカルでは `npm pack --dry-run` で同梱対象を確認できます。
