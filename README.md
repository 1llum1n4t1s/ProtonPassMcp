# Proton Pass MCP

既存の `pass-cli` 認証セッションを使って、MCPクライアントからProton Passを検索するローカルMCPサーバーです。Proton公式の製品ではありません。

## 利用できる機能

| ツール | 用途 |
|---|---|
| `session_status` | セッションの接続確認 |
| `list_vaults` | 保管庫名と共有IDの一覧 |
| `list_shares` | 許可された共有の一覧 |
| `list_items` | タイトルによる検索とアイテム一覧 |
| `search_notes` | テキストノートのタイトル・本文の部分文字列検索（取得制限の設定中は使用不可） |
| `create_field_handoff` | 値を会話へ返さず、保護された一時ファイルへの参照を作成 |
| `release_field_handoff` | 未使用・失敗した受け渡しを回収 |
| `read_field` | 理由を指定して1フィールドを取得。アイテム・フィールド・期限・頻度の制限が可能 |

`search_notes` は本文を内部で照合し、一致するタイトル・ID・状態だけ返します。大文字小文字を区別します。添付ファイルは検索対象に含みません。`state` の既定値は `active`、ごみ箱込みなら `all` を指定します。

`list_vaults` で得た `share_id` ごとに検索します。`complete: false` の場合は、同じ条件に `next_cursor` を `cursor` として渡して続行し、各ページの `matches` を集めてください。対象一覧が途中で変わった場合は最初から検索します。本文は照合時点の値を使います。

`list_items` のタイトル検索は大文字小文字を区別しません。`next_offset` がある場合は、その値を `offset` に指定して続行します。

`search_notes`・`read_field`・`create_field_handoff` は、具体的な依頼・目的を示す `reason`（前後の空白を除いて5〜300文字、Unicodeコードポイント数で計測）が必要です。`read_field` は要求した値を平文のツール結果としてAIへ渡します。接続先の会話履歴・作業ログに残る可能性があり、理由の指定は対話的な承認やログの抑制を行う仕組みではありません。Codexで会話に値を出さず入力する場合は、次のファイル受け渡しを使ってください。

`read_field` の `field` は空白・日本語・セクション名（例 `本番.パスワード`）を含む名前を指定できます。1〜100文字（Unicodeコードポイント数）で、制御文字は使用できません。

### Codexで会話にパスワードを出さずログインする

MCPとCodexのブラウザ実行環境が同じローカルファイルへアクセスできる場合に使えます。MCPから返るのは `handoff_id`・`file_path`・`expires_at`・`consumer_module_url`・フィールド名だけです。パスワード本体は返しません。

1. ログイン先のURLと対象アカウントを確認します。
2. `create_field_handoff` に共有ID・アイテムID・フィールド名・理由を渡します。
3. Codexのブラウザ実行コードで、返された参照を `withFieldHandoff` へ渡して入力します。本文を読むツール、`console.log`、`nodeRepl.write` などへ値を出さないでください。
4. 未使用で中止した場合は `release_field_handoff` に `handoff_id` を渡します。入力時の例外は補助関数が使用後の削除を行います。回収済み・未知のIDへの再実行も安全ですが、当該サーバーで確認できないIDは `{ released: false }` を返します。

Codexの内蔵ブラウザを操作するJavaScriptでの例です。`receipt` は作成ツールが返した参照、`tab` は確認済みのブラウザタブです。URLとラベルは実際のログイン先へ合わせてください。

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('ログイン先が変わりました。');
  }
  await tab.playwright.getByLabel('パスワード', { exact: true }).fill(value);
});
```

補助関数は一度だけファイルを取得できるようにし、コールバックの成功・失敗にかかわらず使用後に削除します。コールバックの戻り値や生の例外も外へ返しません。通常の返却値は `{ consumed: true }` です。

ファイル受け渡しは1.0.10以降で使えます。下記の設定で公開版を起動します。`PROTON_PASS_DISABLE_SECRET_READ=1` は会話へ平文を返す `read_field` だけを無効化し、ファイル受け渡しは引き続き使えます。既存の `PROTON_PASS_ACCESS_POLICY` も併用できます。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@1.0.10"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session",
        "PROTON_PASS_DISABLE_SECRET_READ": "1"
      }
    }
  }
}
```

| 一時ファイルの設定 | 動作 |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | 有効期限。1〜300秒、既定60秒。取得ポリシーの期限が早ければそちらを優先 |
| `PROTON_PASS_HANDOFF_DIR` | 任意の保管用ディレクトリ。既存の親を持つ正規化済みのローカル絶対パスが必要。UNC・ルートディレクトリそのものは指定不可。未指定はユーザー別の一時領域 |

Windowsでは現在のユーザーだけを許可するACL、POSIXでは所有者限定のディレクトリ・ファイル権限を確認してから値を取得します。既存領域の権限が安全でない場合や、リンクを検出した場合は拒否します。権限を自動で緩めたり修復したりはしません。

未使用ファイルは期限回収し、MCPサーバー終了時にも回収します。サーバーが突然終了した場合は監視プロセスが回収します。OS停止などで両方とも動けなかった場合は、次回の起動で期限切れを回収し、所有サーバーの停止を確認できた分は期限前でも回収します。削除に失敗した場合は成功扱いにせず、期限回収を継続します。起動時に既存領域の検証・回収に失敗した場合は起動を拒否するため、保存先とアクセス権を確認してください。

この方式では値が会話へ出る経路を減らせますが、ローカルファイル・実行メモリ・ブラウザ内には平文が存在します。同じOSユーザーや管理者からの隔離、メモリやディスクの復元不能な消去、実行環境の全内部ログへの非保存は保証しません。Grok Botのようにファイルから直接入力できないクライアントでは、この方式での自動入力はできません。

### ログインに使いながら取得範囲を制限する

まずProton側で、エージェント専用のPATに**必要なアイテムだけ・viewer（閲覧専用）・短い有効期限**を設定し、そのPATで認証した専用セッションを使うことを推奨します。保管庫全体を許可すると、その中の全アイテムがアクセス対象になります。PATの作成・期限・権限は [Proton公式のアクセス制御](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control) を参照してください。このMCPはPATや既存セッションの権限を自動変更しません。

MCP側でも `PROTON_PASS_ACCESS_POLICY` に次のようなJSONを指定できます。指定したアカウントの `username`・`password`・`totp` は引き続き取得でき、許可外のアイテムやフィールドはCLIを呼ぶ前に拒否します。

```json
{
  "allowed_items": [
    {
      "share_id": "SHARE_ID",
      "item_id": "ITEM_ID",
      "fields": ["username", "password", "totp"]
    }
  ],
  "max_reads_per_minute": 10
}
```

`SHARE_ID`・`ITEM_ID` は `list_vaults` / `list_shares` / `list_items` で確認して置き換えます。`fields` は保存されたアイテムで使う正確なフィールド名です。設定変更後はMCPサーバーを再起動してください。

取得制限は1.0.10以降で使えます。次の設定で公開版を起動します。パスとIDは自分の配置先・許可するアイテムへ置き換えます。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@1.0.10"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session",
        "PROTON_PASS_ACCESS_POLICY": "{\"allowed_items\":[{\"share_id\":\"SHARE_ID\",\"item_id\":\"ITEM_ID\",\"fields\":[\"username\",\"password\",\"totp\"]}],\"max_reads_per_minute\":10}"
      }
    }
  }
}
```

| 設定項目 | 動作 |
|---|---|
| `allowed_items` | 必須。共有ID・アイテムID・フィールド名の完全一致で許可。空配列なら許可アイテムなしで一覧も空 |
| `max_reads_per_minute` | 直近60秒の取得試行上限。1〜1000、既定10。許可されたフィールドのCLI試行は失敗時も数える |
| `expires_at` | 任意。有効期限をタイムゾーン付きISO 8601で指定。例：`2027-01-01T00:00:00Z`。運用時は必要な期限へ置き換える |

設定中は一覧・タイトル検索も許可されたアイテムと共有に絞ります。ノート本文の照合から許可外の内容を推測する経路を残さないため、`search_notes` は拒否します。期限は処理開始時・認証確認後・結果返却前に確認し、途中で切れた場合も値を返しません。`session_status` は期限切れ後も接続状況を確認できます。

環境変数が未設定なら従来どおり利用できます。設定JSONはUTF-8で64 KiB以内、許可アイテムは最大1000件、各アイテムのフィールドは重複なしの1〜32件です。空文字、不正JSON、未知の設定項目、重複した許可アイテムなどは起動を拒否します。許可を変更するMCPツールは提供していません。

この制限はMCP経由の誤取得や連続取得を抑えるためのものです。回数はサーバープロセスごとに保持し、再起動でリセットします。設定を書き換えたり、別のCLI・MCPプロセスを実行できる相手を隔離する仕組みではないため、Proton側のアクセス制御と組み合わせてください。

`read_field` で取得した値はAIへ渡ります。接続先によるログ保存をこのMCPから禁止したり、取得済みのパスワードを期限切れで消したりすることはできません。ファイル受け渡しを使う場合も、入力先のブラウザURLはCodexの入力コードで確認してください。

### 平文を返す取得ツールを無効にする

`PROTON_PASS_DISABLE_SECRET_READ=1` は、平文を会話へ返す `read_field` を登録しない設定です。`0`・未設定では従来どおり登録し、その他の値は起動拒否です。`create_field_handoff` は引き続き使えるため、この設定のままCodexでファイル経由のログインができます。取得できる対象・フィールドを絞るには `PROTON_PASS_ACCESS_POLICY` を併用してください。このフラグだけで一切の秘密取得を禁止するものではありません。

## 導入

Node.js 22以降が必要です。MCPサーバーをインストールした後、明示的な `setup` コマンドでProton公式の `pass-cli` を導入できます。

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` はProton公式のstable manifestをHTTPSで取得し、現在のOS・CPUに対応する公式配布物をダウンロードします。manifestに記載されたSHA-256と実物が一致した場合だけ展開・配置し、復元不能時に案内する旧版バックアップを除いて一時ファイルを削除します。ログイン、PATの読み取り・保存、PATHの変更は行いません。

`PASS_CLI_PATH` を指定した場合、MCP起動と `--force` を付けない `setup` はその実行ファイルだけを利用します。指定先が無効でも公式の既定配置先や `PATH` へフォールバックせず、安全のため失敗します。省略した場合は、指定した導入先（未指定なら公式の既定配置先）、`PATH` の順に既存CLIを探し、見つかればダウンロードしません。stable版を公式の既定配置先へ明示的に再導入するときは、既存CLIの探索を省略する `--force` を使います。任意の配置先への導入を保証する場合は `--force` と `--install-dir` を併用してください。

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

公式の既定配置先は次のとおりです。

| OS | 対応CPU | 配置先 |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

対応外のOS・CPU、manifest形式の変更、危険なダウンロードURL、サイズ上限超過、SHA-256不一致では、既存のCLIを上書きせず終了します。Proton公式の配布manifestとインストーラーは [Proton Pass CLI](https://github.com/protonpass/pass-cli) で確認できます。

### CLIを認証する

`setup` と認証は分離されています。MCP専用のセッションディレクトリを決め、同じ環境変数を設定した状態で `pass-cli login` を一度実行してください。

Windows PowerShellの例:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

macOS・Linuxの例:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

既存の `pass-cli` を利用する場合や `--install-dir` を指定した場合は、その実行ファイルの絶対パスを `PASS_CLI_PATH` に設定します。認証方法の詳細はProton公式の [Pass CLIドキュメント](https://protonpass.github.io/pass-cli/) を参照してください。

### MCPクライアントへ登録する

MCPクライアントには次のstdio設定を登録します。`PASS_CLI_PATH` は省略すると既定配置先または `PATH` から自動検出されますが、実行するCLIを固定したい場合は明示してください。Windowsでクライアントが `npx` を解決できない場合は、そのクライアントの手順に従って `npx.cmd` またはインストール済みサーバーの絶対パスを指定してください。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@1.0.10"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session"
      }
    }
  }
}
```

自動検出を使う場合は `PASS_CLI_PATH` の行を削除できます。独自のCLI配置先では、その実行ファイルの絶対パスへ変更してください。PATは設定ファイルに保存せず、既存セッションを参照します。秘密の本文やCLIの生エラーをこのサーバーがログへ保存することはありません。フィールド取得の結果は接続先クライアントに渡ります。

「有効なセッションがありません」と表示された場合は、MCPと同じ `PROTON_PASS_SESSION_DIR` を設定して `pass-cli info` で確認します。この表示だけでは期限切れ・失効・保存先の相違を特定できません。保存先が正しく認証が必要な場合は、その保存先で `pass-cli login` により再認証します。CLIが明示した自動ログアウトは別のメッセージで通知します。MCP自身はログアウトやトークンの保存を行いません。

`setup` が既存CLIを見つけられない場合は、`PASS_CLI_PATH` を指定しているなら、その値が正しい実行ファイルを指しているか確認します。自動検出を使うならこの変数を削除し、公式の既定配置先にファイルがあるか、現在のプロセスから `PATH` が見えるかを確認します。Windows ZIPの展開に失敗した場合はWindows PowerShellが利用できることと公式配布物の取得状態を確認してください。SHA-256検証に失敗した場合は検証を無効化せず、公式側のmanifestと配布物が一致してから再実行してください。

更新途中の失敗では既存ファイルを自動復元します。復元にも失敗した場合は、エラーに表示された一時バックアップを削除せず、CLIを停止してから再実行するか、バックアップ内のファイルを導入先へ戻してください。

Windowsで `LOCALAPPDATA` が未設定でも、`PASS_CLI_PATH` または `PATH` 上の既存CLIを利用できます。新規導入で既定の配置先を決定できない場合は、`LOCALAPPDATA` を設定するか、`setup --install-dir` で配置先を指定してください。

## ライセンス

このMCPサーバーは [MIT License](LICENSE) です。`setup` で別途導入するProton Pass CLIはProtonの [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE) に従い、このnpmパッケージにはCLIバイナリを同梱しません。

開発・検証については [CONTRIBUTING.md](CONTRIBUTING.md)、システムの構造については [DESIGN.md](DESIGN.md) を参照してください。
