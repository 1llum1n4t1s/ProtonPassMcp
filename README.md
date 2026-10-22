# Proton Pass MCP

既存の `pass-cli` 認証セッションを使って、MCPクライアントからProton Passを検索するローカルMCPサーバーです。Proton公式の製品ではありません。

## 利用できる機能

| ツール | 用途 |
|---|---|
| `session_status` | セッションの接続確認 |
| `list_vaults` | 保管庫名と共有IDの一覧 |
| `list_shares` | 許可された共有の一覧 |
| `list_items` | タイトルによる検索とアイテム一覧 |
| `search_notes` | テキストノートのタイトル・本文の部分文字列検索 |
| `read_field` | 理由を指定して1フィールドを取得 |

`search_notes` は本文を内部で照合し、一致するタイトル・ID・状態だけ返します。大文字小文字を区別します。添付ファイルは検索対象に含みません。`state` の既定値は `active`、ごみ箱込みなら `all` を指定します。

`list_vaults` で得た `share_id` ごとに検索します。`complete: false` の場合は、同じ条件に `next_cursor` を `cursor` として渡して続行し、各ページの `matches` を集めてください。対象一覧が途中で変わった場合は最初から検索します。本文は照合時点の値を使います。

`list_items` のタイトル検索は大文字小文字を区別しません。`next_offset` がある場合は、その値を `offset` に指定して続行します。

`search_notes` と `read_field` は、具体的な依頼・目的を示す `reason`（前後の空白を除いて5〜300文字、Unicodeコードポイント数で計測）が必要です。`read_field` は要求した値をツール結果へ返します。利用者が必要とするフィールドを指定してください。検索のみなら `search_notes` を使います。

`read_field` の `field` は空白・日本語・セクション名（例 `本番.パスワード`）を含む名前を指定できます。1〜100文字（Unicodeコードポイント数）で、制御文字は使用できません。

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
      "args": ["--yes", "@kagayoi/proton-pass-mcp@1.0.8"],
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
