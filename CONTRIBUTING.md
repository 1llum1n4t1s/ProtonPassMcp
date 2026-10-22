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

## Toolport側の更新と接続確認

このリポジトリで `/vava` を実行するときは、npm公開後に、このPCのToolport専用runtimeの更新と実セッションの接続確認まで続けます。npmの公開確認だけでは、この後続工程を完了にしません。以下はGit参照元の更新とは別に許可されたローカル運用です。

1. 公開したバージョンのnpm配信物を取得・照合してから、`%USERPROFILE%\.local\bin\proton-pass-mcp-wrapper.mjs` を読み、実際のruntime、`PASS_CLI_PATH`、`PROTON_PASS_SESSION_DIR` の設定元を確認します。既存のCLIと認証セッションを引き継ぎ、ログイン情報や秘密フィールドは取得しません。環境変数が未設定なら、ラッパーの既存設定を確認して検証プロセスに渡します。
2. 専用runtime（現在は `%USERPROFILE%\.local\share\toolport-mcp-runtime`）の `@kagayoi/proton-pass-mcp` だけを、今回公開したバージョンに完全固定してpnpmで更新します。`package.json` と `pnpm-lock.yaml` を同期し、`pnpm-workspace.yaml` に当該パッケージの `minimumReleaseAgeExclude` がある場合は同じバージョンへ揃えます。他の直接依存の固定値は維持し、既存のstore配置を確認して使います。更新後は `pnpm install --frozen-lockfile --ignore-scripts` を実行し、設定値とインストール済みパッケージのバージョンを照合します。一時物は作業契約で定めた外部作業領域へ出力します。
3. 既存のCLI・セッション設定で、このリポジトリの `pnpm verify` を実行します。さらにToolportが使うラッパーへMCPクライアントで接続し、initialize応答の `serverInfo.version` が公開バージョンと一致することを確認します。ソース側の成功だけで専用runtimeの検証を代替しません。
4. ToolportのProton Pass接続を更新します。実行時に利用可能な再接続手段と復帰方法を先に確認し、他のサーバーは操作しません。子プロセスの終了だけではToolportが切断済みパイプを保持したため、自動再接続を期待してプロセスを終了しません。このチャットから安全に再接続できなければ、利用者にToolport画面の `proton-pass` をOFF→ONする操作を依頼し、返答後に続行します。
5. 同じチャットからToolport経由で `proton_pass__session_status` の `authenticated: true` と、`proton_pass__list_vaults` による保管庫1件以上の取得を確認します。新しいプロセスが更新済みruntimeを使うことも照合します。保管庫名・ID・秘密値は検証記録へ転載せず、バージョン、成否、件数だけを報告します。不要な一時物を清掃して完了とします。

更新失敗、認証失敗、再接続待ちは、公開済みの同じバージョンの未完了工程として保持し、次回はその工程から再開します。再公開や別バージョンへの更新で置き換えません。完了報告ではnpm公開、専用runtime更新、実セッション検証、Toolport経由の接続確認を区別します。
