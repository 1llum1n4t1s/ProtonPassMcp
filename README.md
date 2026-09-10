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

`search_notes` と `read_field` は、具体的な依頼・目的を示す `reason`（前後の空白を除いて5〜300文字（上限はUnicodeコードポイント数））が必要です。`read_field` は要求した値をツール結果へ返します。利用者が必要とするフィールドを指定してください。検索のみなら `search_notes` を使います。

`read_field` の `field` は空白・日本語・セクション名（例 `本番.パスワード`）を含む名前を指定できます。1〜100文字で、制御文字は使用できません。

## 起動

Node.js 22以降と、インストール・認証済みの `pass-cli` が必要です。環境変数には自分のCLI実行ファイルと認証済みセッションのディレクトリを指定してください。

```powershell
npm install -g @kagayoi/proton-pass-mcp
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
      "args": ["--yes", "@kagayoi/proton-pass-mcp@1.0.3"],
      "env": {
        "PASS_CLI_PATH": "C:/path/to/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/path/to/authenticated-session"
      }
    }
  }
}
```

PATは設定ファイルに保存せず、既存セッションを参照します。秘密の本文やCLIの生エラーをこのサーバーがログへ保存することはありません。フィールド取得の結果は接続先クライアントに渡ります。

「有効なセッションがありません」と表示された場合は、MCPと同じ `PROTON_PASS_SESSION_DIR` を設定して `pass-cli info` で確認します。この表示だけでは期限切れ・失効・保存先の相違を特定できません。保存先が正しく認証が必要な場合は、その保存先で `pass-cli login` により再認証します。CLIが明示した自動ログアウトは別のメッセージで通知します。MCP自身はログアウトやトークンの保存を行いません。

## ライセンス

[MIT License](LICENSE)

開発・検証については [CONTRIBUTING.md](CONTRIBUTING.md)、システムの構造については [DESIGN.md](DESIGN.md) を参照してください。
