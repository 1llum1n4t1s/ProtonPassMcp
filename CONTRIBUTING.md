# 開発・検証

Node.js 22以降とpnpmを使います。

```powershell
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` は認証失敗・検索続行・秘密の出力抑制などをダミーデータで確認します。
`PASS_CLI_PATH` と `PROTON_PASS_SESSION_DIR` を認証済みセッションに設定した `pnpm verify` は、実セッションでMCP接続・一覧・入力検証を確認します。
ソースからの起動は同じ環境変数を設定して `pnpm start` を使います。

公開前に `npm pack --dry-run` で配布ファイルを確認し、`npm publish` で公開します。公開前にはテストが自動実行されます。
パッケージのバージョンは `package.json` が正本です。
