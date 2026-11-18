# 開発・検証

Bun 1.4.4以降を使います。Node.js 22以降による既存のnpx利用も維持します。

依存の新規解決は `bunfig.toml` で pnpm 12 の既定と同じ公開後24時間以上経過したバージョンに制限します。固定済み lockfile のインストールはこの待機の対象外です。`pnpm-lock.yaml` を正本とし、Bun はインストール時にメモリー内で移行します。`--no-save` により別の lockfile は作りません。Dependabot は npm ecosystem としてバージョン更新・セキュリティ修正 PR を扱います。依存更新時には pnpm で manifest と lockfile を同期し、`bun audit` も確認します。

```powershell
bun install --frozen-lockfile --no-save
bun test
```

`bun test` は認証失敗・検索続行・秘密の出力抑制などをダミーデータで確認します。
`PASS_CLI_PATH` と `PROTON_PASS_SESSION_DIR` を認証済みセッションに設定した `bun --no-env-file --no-install scripts/verify.mjs` は、実セッションでMCP接続・一覧・入力検証を確認します。
`PROTON_PASS_DISABLE_SECRET_READ=1` でも同じコマンドを実行でき、7ツールの登録と、有効な引数で `read_field` を直接呼んでも拒否されることを確認します。未設定・`0` では8ツールを提供します。一時ファイル2ツールだけはローカル書込みを行うことも確認します。秘密値や実ファイルは取得・作成せず、作成の不正入力と未知IDの回収を検証します。検証の起動先は利用者と同じ `src/cli.mjs` です。
`PROTON_PASS_ACCESS_POLICY` を設定した場合は、許可された共有だけが一覧へ出ることと、最初の許可共有のアイテム一覧が許可範囲内であることも確認します。単一アイテムの共有や空の許可一覧では保管庫一覧が空でも検証できます。未設定時は従来どおりアクセス可能な保管庫が1件以上必要です。有効期限内の設定を使ってください。このコマンドは許可されたパスワード自体を読みません。

取得制限を変更した場合は、ダミーのCLIを使い、実際の `src/cli.mjs` をstdio MCPクライアントから起動して確認します。許可したフィールドの取得成功、許可外アイテム・フィールドとノート本文検索のCLI実行前拒否、一覧を絞った後のページング、並行取得の回数制限、失敗時の回数消費、待機中の取消、認証中・取得中の期限切れ、不正設定での起動拒否を確認します。制限なしの互換動作と、`PROTON_PASS_DISABLE_SECRET_READ=1` との併用も対象です。実Proton側のPAT権限や、接続先ブラウザでのログイン成功は、このダミー検証とは別です。
ソースからの起動は同じ環境変数を設定して `bun --no-env-file --no-install src/cli.mjs` を使います。`start`、`test`、`verify` はBunが既定です。Node.js 22以降の互換確認には `npm run start:node`、`npm run test:node`、`npm run verify:node` を使います。公開binとnpxのNode.js互換は維持します。

ファイル受け渡しを変更した場合は、Windows実機で現在ユーザーだけのprotected ACLと、安全でない既存領域での取得前拒否を確認します。ダミーCLIを実stdio MCPから呼び、会話へ値が出ないこと、consumerを実IABで読み込んだ入力成功、使用後の不存在、二重使用・コールバック例外・期限切れ・キャンセルでの回収を確認します。サーバー強制終了、監視プロセス単独終了、両方終了後の次回起動時の回収も対象です。実パスワードを検証ログやfixtureへ保存しません。

公開は `.github/workflows/publish.yml` からGitHub OIDC Trusted Publishingを使います。main のコミットに付け `package.json` と一致する軽量タグ `v<version>` をpushすると（release ブランチと GitHub Release は使いません）、依存解決・配布確認・BunとNode.jsのテストを実行します。生成したnpmアーカイブを一度読み込み、manifest全体・許可した全ファイルの内容と種類・重複・CLIの実行権限・READMEの固定バージョンを確認し、同じバイト列のSHA-512を算出します。欠落や改ざんなどの不正なアーカイブを拒否するテストも実行し、公開直前にハッシュを再確認して同じアーカイブを公開します。再開時は同じタグを `--ref` に指定してworkflow_dispatchを実行します。公開済みバージョンはSHA-512とprovenance掲載形式が一致する場合だけ再公開を省略し、内容が異なる場合は停止します。

公開workflowのcheckoutはnative gitと一時的な認証ヘッダーを使い、Git設定へ認証情報を保存しません。SHA固定の公式 setup-bun Action で Bun を準備し、Node.js 26.13.0 と対応下限の 22.0.0 でも既存の利用経路をテストします。これらのAction自体もGitHub ActionsランナーのNode.jsを使います。

公開処理は scripts/Publish-Npm.ps1 を入口とし、PowerShell 7.4以降のAdd-Typeが同梱C#をメモリー内でコンパイルします。npm Trusted Publishingとprovenanceのcloud-hosted build要件に合わせ、publish.ymlのinstall・既存テスト・pack・配布内容とSHA-512検証・公開をGitHub-hosted ubuntu-latestで実行します。通常のdependency-validationはM3 Linux ARM64を使います。同じtarballを作り直さず公開し、保存npm公開tokenは使いません。既存のworkflow filenameとタグ起動・手動再実行の条件、npm側のTrusted Publisher登録を維持します。

native publisherはGitHub OIDC交換による短期tokenとcosign 3.0.4によるSLSA v1 provenance署名を使います。cosignの固定SHA-256・公式Sigstore署名、workflow identity・issuer・subject・archive digestを確認し、同じtarballと一緒に送信します。既存版の省略にはSHA-512とprovenance掲載形式の一致を要求します。PUT成功headerはnpm受理を表し、body解析や公開反映待ちGETは行いません。不明なPUT結果は再送しません。ソースhash別namespaceのPowerShell読込みも維持します。

公開処理の変更時は `pwsh -NoProfile -File scripts/Test-NpmPublisher.ps1 -WorkDirectory <専用の絶対作業パス>` を実行します。実資格情報・実外部APIを使わず、fixture tarball、mock HTTP/cosign、再送しないHTTP境界を確認します。新規公開を許すversion照会応答は404だけです。試験fixtureは専用pathへ置き、終了時に清掃します。

パッケージのバージョンは `package.json` が正本です。ローカルでは `bun pm pack --dry-run` で同梱対象を確認できます。

## Toolport側の更新と接続確認

このリポジトリで `/vava` を実行するときは、npm公開後に、このPCのToolport専用runtimeの更新と実セッションの接続確認まで続けます。npmの公開受付だけでは、この後続工程を完了にしません。以下はGit参照元の更新とは別に許可されたローカル運用です。

1. 公開したバージョンのnpm配信物を取得・照合してから、Toolportが起動するラッパー（現在は `D:\Toolport\wrappers\proton-pass-mcp-wrapper.mjs`）を読み、実際のruntime、`PASS_CLI_PATH`、`PROTON_PASS_SESSION_DIR` の設定元を確認します。配置が変わっている可能性があるため、Toolport経由で起動中のProton Passプロセスがあれば、そのコマンドラインも照合して実際に使われているラッパーとruntimeを特定します。既存のCLIと認証セッションを引き継ぎ、ログイン情報や秘密フィールドは取得しません。環境変数が未設定なら、ラッパーの既存設定を確認して検証プロセスに渡します。
2. 専用runtime（現在は `D:\Toolport\runtimes\node`。app-publish・cws・retroweb等の他のMCPと共有）の `@kagayoi/proton-pass-mcp` だけを、今回公開したバージョンへ更新します。`package.json` の指定子は既存の値（現在は `latest`）を維持し、`pnpm-lock.yaml` で今回公開したバージョンに完全固定します。`pnpm-workspace.yaml` に当該パッケージの `minimumReleaseAgeExclude` がある場合は同じバージョンへ揃えます。他のパッケージの解決済みバージョンとpatchは維持します。`pnpm add` / `pnpm update` は指定子 `latest` の他パッケージを再解決し、旧版向けpatchが `ERR_PNPM_UNUSED_PATCH` で失敗することがあります。その場合は新旧バージョンの依存・engines・binが同一であることをnpm registryで確認し、lockの当該パッケージの項目（importerのversion、packagesのキーとintegrity、snapshotsのキー）だけを書き換えます。更新後は `pnpm install --frozen-lockfile --ignore-scripts --config.optimistic-repeat-install=false` を実行し、設定値とインストール済みパッケージのバージョン、他パッケージのバージョン・patch適用結果が変わっていないことを照合します。`node_modules/.modules.yaml` の `storeDir` が存在しないstoreを指す場合、pnpmはnode_modulesの作り直しを要求します。共有runtimeの他MCPも巻き込むため、作り直しは本人の承認を得てから行います（承認後は旧node_modulesをPrunletで削除し、同じfrozen installで再構築します）。一時物は作業契約で定めた外部作業領域へ出力します。
3. 既存のCLI・セッション設定で、このリポジトリの `bun --no-env-file --no-install scripts/verify.mjs` を実行します。さらにToolportが使うラッパーへMCPクライアントで接続し、initialize応答の `serverInfo.version` が公開バージョンと一致することを確認します。ソース側の成功だけで専用runtimeの検証を代替しません。
4. ToolportのProton Pass接続をONのまま更新します。処理中の操作がないことと対象のPID・実行パス・引数・親子関係を照合し、接続中の旧MCPサーバーだけを終了します。Toolport v1.24.2は連続3回のtransport障害と20秒の待機後に対象を再接続するため、同じチャットから読み取り専用の `proton_pass__session_status({})` を最大3回呼び、切断エラーが続く場合だけ最後の失敗から20秒超待って再確認します。再接続した呼び出しは元エラーを返すことがあるため、合計5回まで確認し、成功時点で止めます。他のサーバーやenabled設定は変更しません。認証・権限・入力の問題にはこの再試行を使わず、自動復旧の上限を確認しても解決しない場合だけ必要な利用者操作を依頼します。Toolport更新で復旧条件が変わった場合は再確認します。
5. 同じチャットからToolport経由で `proton_pass__session_status` の `authenticated: true` と、`proton_pass__list_vaults` による保管庫1件以上の取得を確認します。新しいプロセスが更新済みruntimeを使うことも照合します。ツール追加・変更を含む更新では、ラッパーの `tools/list` とToolportの検索結果・入力スキーマも照合します。保管庫名・ID・秘密値は検証記録へ転載せず、バージョン、成否、件数だけを報告します。不要な一時物を清掃して完了とします。

更新失敗、認証失敗、再接続待ちは、公開済みの同じバージョンの未完了工程として保持し、次回はその工程から再開します。再公開や別バージョンへの更新で置き換えません。完了報告ではnpm公開、専用runtime更新、実セッション検証、Toolport経由の接続確認を区別します。

## 多言語化

- 人が読む文言は `src/locales/<タグ>.json` の9言語の辞書で持ち、キーは `setup.noFetch` のような安定した識別子にします。プレースホルダーは `{name}` 形式で、全言語で同じ集合にします。辞書に無いキーは英語で表示します。
- 文言を足したり変えたりしたら、9言語すべての辞書を更新し、`bun test`（または `npm run test:node`）で `test/i18n.test.mjs` の整合検査（キー集合・プレースホルダー・コードが参照するキー・言語タグの照合・READMEの構成）を通します。
- MCP の説明やAIへ返す応答・エラーは英語のままコードに書き、辞書へ入れません。
- READMEを変えたら全言語版を同時に直します。READMEの他言語版は `package.json` の `files` に列挙せずに済ませるため、Bunの自動同梱に任せ、`scripts/Verify-BunPackage.ps1` の同梱ファイル一覧と件数（`scripts/Test-BunPackageVerifier.ps1`）を更新します。
