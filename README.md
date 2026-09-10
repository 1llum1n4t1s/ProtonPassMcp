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

`read_field` は要求した値をツール結果へ返します。利用者が必要とするフィールドを指定してください。検索のみなら `search_notes` を使います。

## 起動

Node.js 22以降と、インストール・認証済みの `pass-cli` が必要です。環境変数には自分のCLI実行ファイルと認証済みセッションのディレクトリを指定してください。

```powershell
npm install -g proton-pass-mcp-local
$env:PASS_CLI_PATH = 'C:\path\to\pass-cli.exe'
$env:PROTON_PASS_SESSION_DIR = 'C:\path\to\authenticated-session'
proton-pass-mcp
```

MCPクライアントには次のstdio設定を登録します。Windowsでクライアントが `npx` を解決できない場合は、そのクライアントの手順に従って `npx.cmd` またはインストール済みサーバーの絶対パスを指定してください。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "proton-pass-mcp-local@1.0.1"],
      "env": {
        "PASS_CLI_PATH": "C:/path/to/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/path/to/authenticated-session"
      }
    }
  }
}
```

PATは設定ファイルに保存せず、既存セッションを参照します。秘密の本文やCLIの生エラーをこのサーバーがログへ保存することはありません。フィールド取得の結果は接続先クライアントに渡ります。

認証エラー時は、同じ `PROTON_PASS_SESSION_DIR` を設定して `pass-cli login` で再認証します。既存セッションの自動ログアウトやトークンの保存は行いません。

## ライセンス

[MIT License](LICENSE)
