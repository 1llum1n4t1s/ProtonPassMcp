# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

一個本機 MCP 伺服器，讓 MCP 用戶端透過既有的 `pass-cli` 驗證工作階段搜尋 Proton Pass。它不是 Proton 官方產品。

如果不使用 Node.js，請安裝 Bun 1.4.4 或更新版本，並將下方的 `"command": "npx"` 與 `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` 分別改為 `"command": "bunx"` 與 `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]`（作為指令為 `bunx --bun @kagayoi/proton-pass-mcp@latest`）。必須使用 `--bun`，才能以 Bun 而非 Node.js 執行。既有的 `npx` 設定在 Node.js 22 或更新版本上也可繼續使用。

## 功能

| 工具 | 用途 |
|---|---|
| `session_status` | 檢查工作階段連線 |
| `list_vaults` | 保管庫名稱與共用 ID 清單 |
| `list_shares` | 已允許的共用清單 |
| `list_items` | 依標題搜尋並列出項目 |
| `search_notes` | 對文字筆記的標題與內文做子字串搜尋（設定了取得限制時無法使用） |
| `create_field_handoff` | 不把值傳回對話，而是建立指向受保護暫存檔案的參照 |
| `release_field_handoff` | 回收未使用或失敗的交接 |
| `read_field` | 說明理由後讀取 1 個欄位。可限制項目、欄位、有效期限與頻率 |

`search_notes` 在內部比對內文，只傳回相符的標題、ID 與狀態。區分大小寫，不搜尋附件。`state` 預設為 `active`，若要包含垃圾桶請指定 `all`。

請針對 `list_vaults` 取得的每個 `share_id` 分別搜尋。如果 `complete: false`，請以相同條件並將 `next_cursor` 作為 `cursor` 傳入以繼續，並彙整各頁的 `matches`。如果目標清單在中途變更，請從頭重新搜尋。內文使用比對當下的值。

`list_items` 的標題搜尋不區分大小寫。若有 `next_offset`，請將該值指定為 `offset` 繼續。

`search_notes`、`read_field` 與 `create_field_handoff` 需要說明具體請求或目的的 `reason`（去除前後空白後 5 到 300 個字元，以 Unicode 碼位計算）。`read_field` 會把所要求的值以純文字工具結果交給 AI。它可能留存在所連線服務的對話記錄與工作記錄中，指定理由並不是互動式核准或抑制記錄的機制。若要在 Codex 中輸入而不在對話中顯示值，請使用下方的檔案交接。

`read_field` 的 `field` 可以指定包含空白、非 ASCII 字元或區段名稱的名稱（例如 `Production.Password`）。長度為 1 到 100 個字元（以 Unicode 碼位計算），不可包含控制字元。

### 在 Codex 中登入而不在對話裡顯示密碼

當 MCP 與 Codex 的瀏覽器執行環境可以存取同一個本機檔案時可以使用。MCP 只會傳回 `handoff_id`、`file_path`、`expires_at`、`consumer_module_url` 與欄位名稱，不會傳回密碼本身。

1. 確認登入目標 URL 與目標帳戶。
2. 將共用 ID、項目 ID、欄位名稱與理由傳給 `create_field_handoff`。
3. 在 Codex 的瀏覽器執行程式碼中，將傳回的參照傳給 `withFieldHandoff` 進行輸入。請勿把值輸出到讀取內文的工具、`console.log`、`nodeRepl.write` 等。
4. 若未使用就中止，請把 `handoff_id` 傳給 `release_field_handoff`。輸入時發生例外，輔助函式會在使用後刪除。對已回收或未知 ID 重複執行也是安全的，但該伺服器無法確認的 ID 會傳回 `{ released: false }`。

以下是操作 Codex 內建瀏覽器的 JavaScript 範例。`receipt` 是建立工具傳回的參照，`tab` 是已確認的瀏覽器分頁。請依實際登入目標調整 URL 與標籤。

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('登入目標已變更。');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

輔助函式只允許取得一次檔案，無論回呼成功或失敗，使用後都會刪除。回呼的傳回值與原始例外也不會向外傳回。一般的傳回值為 `{ consumed: true }`。

檔案交接自 1.0.10 起可用。請以下方的設定啟動公開版本。`PROTON_PASS_DISABLE_SECRET_READ=1` 只會停用把純文字傳回對話的 `read_field`，檔案交接仍可繼續使用。也可以與既有的 `PROTON_PASS_ACCESS_POLICY` 並用。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@latest"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session",
        "PROTON_PASS_DISABLE_SECRET_READ": "1"
      }
    }
  }
}
```

| 暫存檔案設定 | 行為 |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | 有效期限。1 到 300 秒，預設 60 秒。若取得原則的期限較早，則以其為準 |
| `PROTON_PASS_HANDOFF_DIR` | 選用的存放目錄。需為已正規化、父目錄已存在的本機絕對路徑。不可指定 UNC 路徑或根目錄本身。未指定時使用依使用者區分的暫存區域 |

在取得值之前，Windows 上會確認僅允許目前使用者的 ACL，POSIX 上會確認僅限擁有者的目錄與檔案權限。如果既有區域的權限不安全或偵測到連結，則拒絕。不會自動放寬或修復權限。

未使用的檔案會在到期時回收，並在 MCP 伺服器結束時回收。如果伺服器突然終止，監看程序會回收。如果因作業系統停止等原因兩者都未能執行，則下次啟動時回收已過期的檔案，且已確認所屬伺服器已停止的檔案即使未到期也會回收。刪除失敗不視為成功，會繼續依期限回收。如果啟動時驗證或回收既有區域失敗，則拒絕啟動，請檢查存放位置與存取權限。

這種方式可以減少值進入對話的途徑，但純文字仍存在於本機檔案、執行記憶體與瀏覽器中。不保證與同一作業系統使用者或管理員隔離，不保證無法復原地清除記憶體或磁碟，也不保證執行環境的所有內部記錄中都不留存。像 Grok Bot 這樣無法直接從檔案輸入的用戶端，無法使用此方式自動輸入。

### 在登入的同時限制可取得的範圍

建議先在 Proton 端為代理程式專用的 PAT 設定**僅必要的項目、viewer（唯讀）、較短的有效期限**，並使用以該 PAT 驗證的專用工作階段。如果允許整個保管庫，其中所有項目都會成為存取對象。PAT 的建立、期限與權限請參閱 [Proton 官方的存取控制](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control)。此 MCP 不會自動變更 PAT 或既有工作階段的權限。

在 MCP 端，也可以在 `PROTON_PASS_ACCESS_POLICY` 中指定如下 JSON。指定帳戶的 `username`、`password` 與 `totp` 仍可取得，不被允許的項目或欄位會在呼叫 CLI 之前被拒絕。

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

請將 `SHARE_ID` 與 `ITEM_ID` 替換為透過 `list_vaults` / `list_shares` / `list_items` 確認的值。`fields` 是已儲存項目中使用的正確欄位名稱。變更設定後請重新啟動 MCP 伺服器。

取得限制自 1.0.10 起可用。請以下方的設定啟動公開版本。路徑與 ID 請替換為自己的位置與要允許的項目。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@latest"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session",
        "PROTON_PASS_ACCESS_POLICY": "{\"allowed_items\":[{\"share_id\":\"SHARE_ID\",\"item_id\":\"ITEM_ID\",\"fields\":[\"username\",\"password\",\"totp\"]}],\"max_reads_per_minute\":10}"
      }
    }
  }
}
```

| 設定項目 | 行為 |
|---|---|
| `allowed_items` | 必填。依共用 ID、項目 ID 與欄位名稱完全相符來允許。空陣列表示沒有允許的項目，清單也為空 |
| `max_reads_per_minute` | 最近 60 秒內的取得嘗試上限。1 到 1000，預設 10。對允許欄位的 CLI 嘗試即使失敗也會計數 |
| `expires_at` | 選用。以含時區的 ISO 8601 指定有效期限，例如 `2027-01-01T00:00:00Z`。運作時請替換為所需的期限 |

設定後，清單與標題搜尋也會限縮在允許的項目與共用範圍內。為了不留下透過筆記內文比對推測未允許內容的途徑，`search_notes` 會被拒絕。有效期限會在處理開始時、驗證確認後與傳回結果前檢查，即使中途過期也不會傳回值。`session_status` 在過期後仍可檢查連線狀態。

未設定環境變數時與以往相同。設定 JSON 須為 UTF-8 且不超過 64 KiB，允許的項目最多 1000 個，每個項目的欄位為 1 到 32 個且不重複。空字串、無效 JSON、未知設定項目與重複的允許項目等會在啟動時被拒絕。不提供變更許可的 MCP 工具。

此限制用於減少透過 MCP 的誤取或連續取得。計數依伺服器程序保存，重新啟動後重置。它不是用來隔離能夠改寫設定或執行其他 CLI、MCP 程序者的機制，請與 Proton 端的存取控制搭配使用。

透過 `read_field` 取得的值會交給 AI。此 MCP 無法禁止所連線服務儲存記錄，也無法在過期時清除已取得的密碼。即使使用檔案交接，也請在 Codex 的輸入程式碼中確認輸入目標的瀏覽器 URL。

### 停用傳回純文字的取得工具

`PROTON_PASS_DISABLE_SECRET_READ=1` 表示不註冊把純文字傳回對話的 `read_field`。`0` 或未設定時與以往一樣註冊，其他值會拒絕啟動。`create_field_handoff` 仍可使用，因此在此設定下仍可透過檔案在 Codex 中登入。若要限定可取得的對象與欄位，請與 `PROTON_PASS_ACCESS_POLICY` 並用。僅憑這個旗標並不能禁止一切機密取得。

## 安裝

需要 Node.js 22 或更新版本。安裝 MCP 伺服器後，可以用明確的 `setup` 指令安裝 Proton 官方的 `pass-cli`。

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` 透過 HTTPS 取得 Proton 官方的 stable 清單，並下載與目前作業系統及 CPU 對應的官方發佈檔案。只有清單中記載的 SHA-256 與實際檔案一致時才會解壓縮並放置，並刪除暫存檔案（無法還原時提示的舊版本備份除外）。它不會登入、讀取或儲存 PAT，也不會變更 PATH。

指定了 `PASS_CLI_PATH` 時，MCP 啟動與不帶 `--force` 的 `setup` 只會使用該可執行檔。即使指定的位置無效，也不會退回到官方預設位置或 `PATH`，基於安全考量會失敗。省略時，會依序在指定的安裝目錄（未指定則為官方預設位置）與 `PATH` 中尋找既有 CLI，找到則不下載。若要將 stable 版明確地重新安裝到官方預設位置，請使用略過既有 CLI 尋找的 `--force`。若要保證安裝到任意位置，請同時使用 `--force` 與 `--install-dir`。

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

官方預設位置如下。

| OS | 支援的 CPU | 位置 |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

遇到不支援的作業系統或 CPU、清單格式變更、危險的下載 URL、超出大小上限或 SHA-256 不一致時，會在不覆寫既有 CLI 的情況下結束。Proton 官方的發佈清單與安裝程式可在 [Proton Pass CLI](https://github.com/protonpass/pass-cli) 查看。

### 驗證 CLI

`setup` 與驗證是分開的。請決定 MCP 專用的工作階段目錄，並在設定了相同環境變數的狀態下執行一次 `pass-cli login`。

Windows PowerShell 範例：

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

macOS 與 Linux 範例：

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

使用既有的 `pass-cli` 或指定了 `--install-dir` 時，請將該可執行檔的絕對路徑設定到 `PASS_CLI_PATH`。驗證方法的詳細資訊請參閱 Proton 官方的 [Pass CLI 文件](https://protonpass.github.io/pass-cli/)。

### 註冊到 MCP 用戶端

請在 MCP 用戶端中註冊下方的 stdio 設定。省略 `PASS_CLI_PATH` 時會從預設位置或 `PATH` 自動偵測，但如果想固定要執行的 CLI，請明確指定。在 Windows 上，如果用戶端無法解析 `npx`，請依該用戶端的說明指定 `npx.cmd` 或已安裝伺服器的絕對路徑。

```json
{
  "mcpServers": {
    "proton-pass": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/proton-pass-mcp@latest"],
      "env": {
        "PASS_CLI_PATH": "C:/Users/USER/AppData/Local/Programs/ProtonPass/pass-cli.exe",
        "PROTON_PASS_SESSION_DIR": "C:/Users/USER/AppData/Local/Kagayoi/ProtonPassMcp/session"
      }
    }
  }
}
```

指定 `@latest` 後，MCP 用戶端每次啟動伺服器都會使用 npm 上的最新版本。如果已經以 `@kagayoi/proton-pass-mcp@1.0.12` 這樣的固定版本註冊，請將已註冊的啟動引數改寫為 `@kagayoi/proton-pass-mcp@latest`，此後會自動使用最新版本（僅更新 README 不會改變既有註冊）。如果想固定到特定版本，請以這種固定版本的形式註冊。

使用自動偵測時，可以刪除 `PASS_CLI_PATH` 一行。對於自訂的 CLI 位置，請改為該可執行檔的絕對路徑。PAT 不會儲存到設定檔中，而是參照既有工作階段。此伺服器不會把機密內文或 CLI 的原始錯誤儲存到記錄。欄位取得的結果會交給所連線的用戶端。

如果提示沒有有效的工作階段，請設定與 MCP 相同的 `PROTON_PASS_SESSION_DIR`，並用 `pass-cli info` 確認。僅憑此提示無法判斷是過期、失效還是存放位置不同。如果位置正確但需要驗證，請在該位置用 `pass-cli login` 重新驗證。CLI 明確給出的自動登出會以另一則訊息通知。MCP 本身不會登出，也不會儲存權杖。

如果 `setup` 找不到既有 CLI，且指定了 `PASS_CLI_PATH`，請確認該值指向正確的可執行檔。使用自動偵測時，請刪除此變數，並確認官方預設位置是否有該檔案、目前程序是否能看到 `PATH`。如果 Windows ZIP 解壓縮失敗，請確認 Windows PowerShell 可用以及官方發佈檔案的取得狀態。如果 SHA-256 驗證失敗，請不要停用驗證，待官方清單與發佈檔案一致後再重新執行。

如果更新中途失敗，會自動還原既有檔案。如果還原也失敗，請不要刪除錯誤中顯示的暫存備份，先停止 CLI 後重新執行，或把備份中的檔案放回安裝目錄。

在 Windows 上，即使未設定 `LOCALAPPDATA`，也可以使用 `PASS_CLI_PATH` 或 `PATH` 上的既有 CLI。全新安裝無法決定預設位置時，請設定 `LOCALAPPDATA`，或用 `setup --install-dir` 指定安裝位置。

## 授權

此 MCP 伺服器採用 [MIT License](LICENSE)。透過 `setup` 另行安裝的 Proton Pass CLI 遵循 Proton 的 [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE)，此 npm 套件不包含 CLI 二進位檔。

開發與驗證請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)，系統結構請參閱 [DESIGN.md](DESIGN.md)。
