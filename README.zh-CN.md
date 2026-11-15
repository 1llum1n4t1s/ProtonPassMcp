# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

一个本地 MCP 服务器，让 MCP 客户端通过已有的 `pass-cli` 认证会话搜索 Proton Pass。它不是 Proton 官方产品。

如果不使用 Node.js，请安装 Bun 1.4.4 或更高版本，并将下面的 `"command": "npx"` 和 `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` 分别改为 `"command": "bunx"` 和 `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]`（作为命令为 `bunx --bun @kagayoi/proton-pass-mcp@latest`）。必须使用 `--bun`，才能用 Bun 而不是 Node.js 运行。现有的 `npx` 配置在 Node.js 22 或更高版本上也可继续使用。

## 功能

| 工具 | 用途 |
|---|---|
| `session_status` | 检查会话连接 |
| `list_vaults` | 保管库名称和共享 ID 列表 |
| `list_shares` | 已允许的共享列表 |
| `list_items` | 按标题搜索并列出条目 |
| `search_notes` | 对文本笔记的标题和正文做子串搜索（设置了获取限制时不可用） |
| `create_field_handoff` | 不把值返回到对话中，而是创建指向受保护临时文件的引用 |
| `release_field_handoff` | 回收未使用或失败的交接 |
| `read_field` | 说明理由后读取 1 个字段。可限制条目、字段、有效期和频率 |

`search_notes` 在内部匹配正文，只返回匹配的标题、ID 和状态。区分大小写，不搜索附件。`state` 默认为 `active`，要包含回收站请指定 `all`。

请针对 `list_vaults` 得到的每个 `share_id` 分别搜索。如果 `complete: false`，请用相同条件并把 `next_cursor` 作为 `cursor` 传入以继续，并汇总各页的 `matches`。如果目标列表在中途发生变化，请从头重新搜索。正文使用匹配时的值。

`list_items` 的标题搜索不区分大小写。如果有 `next_offset`，请将该值指定为 `offset` 继续。

`search_notes`、`read_field` 和 `create_field_handoff` 需要说明具体请求或目的的 `reason`（去除首尾空白后 5 到 300 个字符，按 Unicode 码点计数）。`read_field` 会把所请求的值作为明文工具结果交给 AI。它可能留在所连接服务的对话历史和工作日志中，指定理由并不是交互式批准或抑制日志的机制。如果要在 Codex 中输入而不在对话中显示值，请使用下面的文件交接。

`read_field` 的 `field` 可以指定包含空格、非 ASCII 字符或节名称的名称（例如 `Production.Password`）。长度为 1 到 100 个字符（按 Unicode 码点），不能包含控制字符。

### 在 Codex 中登录而不在对话里显示密码

当 MCP 和 Codex 的浏览器执行环境可以访问同一个本地文件时可以使用。MCP 只返回 `handoff_id`、`file_path`、`expires_at`、`consumer_module_url` 和字段名，不会返回密码本身。

1. 确认登录目标 URL 和目标账户。
2. 将共享 ID、条目 ID、字段名和理由传给 `create_field_handoff`。
3. 在 Codex 的浏览器执行代码中，将返回的引用传给 `withFieldHandoff` 进行输入。请勿把值输出到读取正文的工具、`console.log`、`nodeRepl.write` 等。
4. 如果未使用就中止，请把 `handoff_id` 传给 `release_field_handoff`。输入时发生异常，辅助函数会在使用后删除。对已回收或未知 ID 重复执行也是安全的，但该服务器无法确认的 ID 会返回 `{ released: false }`。

下面是操作 Codex 内置浏览器的 JavaScript 示例。`receipt` 是创建工具返回的引用，`tab` 是已确认的浏览器标签页。请根据实际登录目标调整 URL 和标签。

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('登录目标已变更。');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

辅助函数只允许获取一次文件，无论回调成功还是失败，使用后都会删除。回调的返回值和原始异常也不会向外返回。通常的返回值为 `{ consumed: true }`。

文件交接自 1.0.10 起可用。请用下面的配置启动公开版本。`PROTON_PASS_DISABLE_SECRET_READ=1` 只会禁用把明文返回到对话的 `read_field`，文件交接仍可继续使用。也可以与现有的 `PROTON_PASS_ACCESS_POLICY` 并用。

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

| 临时文件设置 | 行为 |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | 有效期。1 到 300 秒，默认 60 秒。如果获取策略的有效期更早，则以其为准 |
| `PROTON_PASS_HANDOFF_DIR` | 可选的存放目录。需要是已规范化、父目录已存在的本地绝对路径。不能指定 UNC 路径或根目录本身。未指定时使用按用户划分的临时区域 |

在获取值之前，Windows 上会确认仅允许当前用户的 ACL，POSIX 上会确认仅限所有者的目录和文件权限。如果已有区域的权限不安全或检测到链接，则拒绝。不会自动放宽或修复权限。

未使用的文件会在到期时回收，并在 MCP 服务器退出时回收。如果服务器突然终止，监视进程会回收。如果因操作系统停止等原因两者都未能运行，则下次启动时回收已过期的文件，并且已确认所属服务器已停止的文件即使未到期也会回收。删除失败不视为成功，会继续按期限回收。如果启动时验证或回收已有区域失败，则拒绝启动，请检查存放位置和访问权限。

这种方式可以减少值进入对话的途径，但明文仍存在于本地文件、执行内存和浏览器中。不保证与同一操作系统用户或管理员隔离，不保证无法恢复地清除内存或磁盘，也不保证执行环境的所有内部日志中都不留存。像 Grok Bot 这样无法直接从文件输入的客户端，无法使用此方式自动输入。

### 在登录的同时限制可获取的范围

建议先在 Proton 一侧为代理专用的 PAT 设置**仅必要的条目、viewer（只读）、较短的有效期**，并使用以该 PAT 认证的专用会话。如果允许整个保管库，其中所有条目都会成为访问对象。PAT 的创建、有效期和权限请参阅 [Proton 官方的访问控制](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control)。此 MCP 不会自动更改 PAT 或现有会话的权限。

在 MCP 一侧，也可以在 `PROTON_PASS_ACCESS_POLICY` 中指定如下 JSON。指定账户的 `username`、`password` 和 `totp` 仍可获取，不被允许的条目或字段会在调用 CLI 之前被拒绝。

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

请将 `SHARE_ID` 和 `ITEM_ID` 替换为通过 `list_vaults` / `list_shares` / `list_items` 确认的值。`fields` 是已保存条目中使用的准确字段名。更改设置后请重启 MCP 服务器。

获取限制自 1.0.10 起可用。请用下面的配置启动公开版本。路径和 ID 请替换为自己的位置和要允许的条目。

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

| 设置项 | 行为 |
|---|---|
| `allowed_items` | 必填。按共享 ID、条目 ID 和字段名完全匹配来允许。空数组表示没有允许的条目，列表也为空 |
| `max_reads_per_minute` | 最近 60 秒内的获取尝试上限。1 到 1000，默认 10。对允许字段的 CLI 尝试即使失败也会计数 |
| `expires_at` | 可选。以带时区的 ISO 8601 指定有效期，例如 `2027-01-01T00:00:00Z`。运行时请替换为所需的期限 |

设置后，列表和标题搜索也会限定在允许的条目和共享范围内。为了不留下通过笔记正文匹配推测未允许内容的途径，`search_notes` 会被拒绝。有效期会在处理开始时、认证确认后和返回结果前检查，即使中途过期也不会返回值。`session_status` 在过期后仍可检查连接状态。

未设置环境变量时与以往相同。设置 JSON 须为 UTF-8 且不超过 64 KiB，允许的条目最多 1000 个，每个条目的字段为 1 到 32 个且不重复。空字符串、无效 JSON、未知设置项和重复的允许条目等会在启动时被拒绝。不提供更改许可的 MCP 工具。

此限制用于减少通过 MCP 的误取或连续获取。计数按服务器进程保存，重启后重置。它不是用来隔离能够改写设置或运行其他 CLI、MCP 进程的人的机制，请与 Proton 一侧的访问控制配合使用。

通过 `read_field` 获取的值会交给 AI。此 MCP 无法禁止所连接服务保存日志，也无法在过期时清除已获取的密码。即使使用文件交接，也请在 Codex 的输入代码中确认输入目标的浏览器 URL。

### 禁用返回明文的获取工具

`PROTON_PASS_DISABLE_SECRET_READ=1` 表示不注册把明文返回到对话的 `read_field`。`0` 或未设置时与以往一样注册，其他值会拒绝启动。`create_field_handoff` 仍可使用，因此在此设置下仍可通过文件在 Codex 中登录。要限定可获取的对象和字段，请与 `PROTON_PASS_ACCESS_POLICY` 并用。仅凭这个标志并不能禁止一切机密获取。

## 安装

需要 Node.js 22 或更高版本。安装 MCP 服务器后，可以用明确的 `setup` 命令安装 Proton 官方的 `pass-cli`。

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` 通过 HTTPS 获取 Proton 官方的 stable 清单，并下载与当前操作系统和 CPU 对应的官方分发文件。只有清单中记载的 SHA-256 与实际文件一致时才会解压并放置，并删除临时文件（无法恢复时提示的旧版本备份除外）。它不会登录、读取或保存 PAT，也不会更改 PATH。

指定了 `PASS_CLI_PATH` 时，MCP 启动和不带 `--force` 的 `setup` 只会使用该可执行文件。即使指定的位置无效，也不会回退到官方默认位置或 `PATH`，出于安全考虑会失败。省略时，会依次在指定的安装目录（未指定则为官方默认位置）和 `PATH` 中查找现有 CLI，找到则不下载。要把 stable 版明确地重新安装到官方默认位置，请使用跳过现有 CLI 查找的 `--force`。要保证安装到任意位置，请同时使用 `--force` 和 `--install-dir`。

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

官方默认位置如下。

| OS | 支持的 CPU | 位置 |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

遇到不支持的操作系统或 CPU、清单格式变更、危险的下载 URL、超出大小上限或 SHA-256 不一致时，会在不覆盖现有 CLI 的情况下退出。Proton 官方的分发清单和安装程序可在 [Proton Pass CLI](https://github.com/protonpass/pass-cli) 查看。

### 认证 CLI

`setup` 与认证是分开的。请确定 MCP 专用的会话目录，并在设置了相同环境变量的状态下执行一次 `pass-cli login`。

Windows PowerShell 示例：

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

macOS 和 Linux 示例：

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

使用现有的 `pass-cli` 或指定了 `--install-dir` 时，请将该可执行文件的绝对路径设置到 `PASS_CLI_PATH`。认证方法的详细信息请参阅 Proton 官方的 [Pass CLI 文档](https://protonpass.github.io/pass-cli/)。

### 注册到 MCP 客户端

请在 MCP 客户端中注册下面的 stdio 配置。省略 `PASS_CLI_PATH` 时会从默认位置或 `PATH` 自动检测，但如果想固定要运行的 CLI，请明确指定。在 Windows 上，如果客户端无法解析 `npx`，请按该客户端的说明指定 `npx.cmd` 或已安装服务器的绝对路径。

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

指定 `@latest` 后，MCP 客户端每次启动服务器都会使用 npm 上的最新版本。如果已经以 `@kagayoi/proton-pass-mcp@1.0.12` 这样的固定版本注册，请将已注册的启动参数改写为 `@kagayoi/proton-pass-mcp@latest`，此后会自动使用最新版本（仅更新 README 不会改变现有注册）。如果想固定到特定版本，请以这种固定版本的形式注册。

使用自动检测时，可以删除 `PASS_CLI_PATH` 一行。对于自定义的 CLI 位置，请改为该可执行文件的绝对路径。PAT 不会保存到配置文件中，而是引用现有会话。此服务器不会把机密正文或 CLI 的原始错误保存到日志。字段获取的结果会交给所连接的客户端。

如果提示没有有效的会话，请设置与 MCP 相同的 `PROTON_PASS_SESSION_DIR`，并用 `pass-cli info` 确认。仅凭此提示无法判断是过期、失效还是存放位置不同。如果位置正确但需要认证，请在该位置用 `pass-cli login` 重新认证。CLI 明确给出的自动登出会用另一条消息通知。MCP 本身不会登出，也不会保存令牌。

如果 `setup` 找不到现有 CLI，且指定了 `PASS_CLI_PATH`，请确认该值指向正确的可执行文件。使用自动检测时，请删除此变量，并确认官方默认位置是否有该文件、当前进程是否能看到 `PATH`。如果 Windows ZIP 解压失败，请确认 Windows PowerShell 可用以及官方分发文件的获取状态。如果 SHA-256 验证失败，请不要关闭验证，待官方清单与分发文件一致后再重新运行。

如果更新中途失败，会自动恢复现有文件。如果恢复也失败，请不要删除错误中显示的临时备份，先停止 CLI 后重新运行，或把备份中的文件放回安装目录。

在 Windows 上，即使未设置 `LOCALAPPDATA`，也可以使用 `PASS_CLI_PATH` 或 `PATH` 上的现有 CLI。全新安装无法确定默认位置时，请设置 `LOCALAPPDATA`，或用 `setup --install-dir` 指定安装位置。

## 许可证

此 MCP 服务器采用 [MIT License](LICENSE)。通过 `setup` 另行安装的 Proton Pass CLI 遵循 Proton 的 [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE)，此 npm 包不包含 CLI 二进制文件。

开发和验证请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)，系统结构请参阅 [DESIGN.md](DESIGN.md)。
