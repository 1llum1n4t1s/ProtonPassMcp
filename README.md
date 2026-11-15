# Proton Pass MCP

**English** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

A local MCP server that lets an MCP client search Proton Pass through an existing `pass-cli` authenticated session. It is not an official Proton product.

To avoid Node.js, install Bun 1.4.4 or later and change `"command": "npx"` and `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` below to `"command": "bunx"` and `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]` respectively (as a command: `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` is required to run on Bun instead of Node.js. Existing `npx` configurations also keep working on Node.js 22 or later.

## Features

| Tool | Purpose |
|---|---|
| `session_status` | Check the session connection |
| `list_vaults` | List vault names and share IDs |
| `list_shares` | List the allowed shares |
| `list_items` | Search by title and list items |
| `search_notes` | Substring search over the title and body of text notes (unavailable while an access policy is set) |
| `create_field_handoff` | Create a reference to a protected temporary file without returning the value to the conversation |
| `release_field_handoff` | Reclaim unused or failed handoffs |
| `read_field` | Read one field with a stated reason. Items, fields, expiry, and frequency can be restricted |

`search_notes` matches bodies internally and returns only the matching titles, IDs, and states. It is case-sensitive. Attachments are not searched. `state` defaults to `active`; specify `all` to include the trash.

Search per `share_id` obtained from `list_vaults`. If `complete: false`, continue by passing `next_cursor` as `cursor` with the same criteria, and collect the `matches` of every page. If the target list changes midway, search again from the start. Bodies are matched using their values at the time of matching.

The title search of `list_items` is case-insensitive. If `next_offset` is present, continue by passing it as `offset`.

`search_notes`, `read_field`, and `create_field_handoff` require a `reason` (5 to 300 characters after trimming surrounding whitespace, counted in Unicode code points) stating the concrete request or purpose. `read_field` hands the requested value to the AI as a plain-text tool result. It may remain in the connected conversation history and work logs, and specifying a reason is not a mechanism for interactive approval or for suppressing logs. To enter a value in Codex without showing it in the conversation, use the file handoff below.

The `field` of `read_field` can be a name containing spaces, non-ASCII characters, or a section name (for example `Production.Password`). It must be 1 to 100 characters (in Unicode code points) and must not contain control characters.

### Log in from Codex without showing the password in the conversation

This works when the MCP and the Codex browser execution environment can access the same local files. The MCP returns only `handoff_id`, `file_path`, `expires_at`, `consumer_module_url`, and the field name. It never returns the password itself.

1. Confirm the login URL and the target account.
2. Pass the share ID, item ID, field name, and reason to `create_field_handoff`.
3. In the Codex browser execution code, pass the returned reference to `withFieldHandoff` to enter the value. Do not output the value to tools that read the body, `console.log`, `nodeRepl.write`, and so on.
4. If you abort without using it, pass the `handoff_id` to `release_field_handoff`. If the entry throws, the helper deletes the file after use. Running it again for an already reclaimed or unknown ID is safe, but an ID this server cannot confirm returns `{ released: false }`.

Here is an example in JavaScript that drives the Codex built-in browser. `receipt` is the reference returned by the create tool, and `tab` is a confirmed browser tab. Adjust the URL and the label to the actual login target.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('The login target changed.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

The helper makes the file retrievable only once and deletes it after use whether the callback succeeds or fails. It also never returns the callback's return value or raw exceptions. The normal return value is `{ consumed: true }`.

The file handoff is available since 1.0.10. Start the published version with the configuration below. `PROTON_PASS_DISABLE_SECRET_READ=1` disables only `read_field`, which returns plain text to the conversation; the file handoff remains available. An existing `PROTON_PASS_ACCESS_POLICY` can be used together with it.

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

| Temporary file setting | Behavior |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | Expiry. 1 to 300 seconds, default 60. If the access policy expires earlier, that takes precedence |
| `PROTON_PASS_HANDOFF_DIR` | Optional storage directory. Must be a normalized local absolute path with an existing parent. UNC paths and the root directory itself are not allowed. If unset, a per-user temporary area is used |

Before storing a value, the server verifies an ACL that allows only the current user on Windows, and owner-only directory and file permissions on POSIX. It refuses if an existing area has unsafe permissions or a link is detected. It never loosens or repairs permissions automatically.

Unused files are reclaimed at expiry and when the MCP server exits. If the server terminates abruptly, a watcher process reclaims them. If neither could run (for example because the OS stopped), the next start reclaims the expired ones, and also the ones whose owning server is confirmed stopped even before expiry. A failed deletion is not treated as success, and the expiry cleanup continues. If validating or reclaiming the existing area fails at startup, startup is refused, so check the storage location and access rights.

This approach reduces the paths by which a value reaches the conversation, but plain text exists in local files, execution memory, and the browser. It does not guarantee isolation from the same OS user or administrators, irrecoverable erasure of memory or disk, or that nothing is stored in any internal log of the execution environment. Clients that cannot type from a file directly, such as Grok Bot, cannot use this approach for automatic entry.

### Log in while restricting what can be read

On the Proton side, it is recommended to first create an agent-only PAT with **only the necessary items, viewer (read-only), and a short expiry**, and to use a dedicated session authenticated with that PAT. Allowing a whole vault makes every item in it accessible. For creating the PAT, its expiry, and its permissions, see the [official Proton access control](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control). This MCP never changes the permissions of a PAT or an existing session automatically.

On the MCP side, you can also set JSON like the following in `PROTON_PASS_ACCESS_POLICY`. The `username`, `password`, and `totp` of the specified account remain retrievable, and items or fields that are not allowed are refused before the CLI is called.

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

Replace `SHARE_ID` and `ITEM_ID` with values confirmed through `list_vaults` / `list_shares` / `list_items`. `fields` are the exact field names used by the stored item. Restart the MCP server after changing the settings.

The access restriction is available since 1.0.10. Start the published version with the configuration below. Replace the paths and IDs with your own location and the items you allow.

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

| Setting | Behavior |
|---|---|
| `allowed_items` | Required. Allowed by exact match of share ID, item ID, and field name. An empty array means no allowed items and an empty list |
| `max_reads_per_minute` | Limit on read attempts in the last 60 seconds. 1 to 1000, default 10. CLI attempts for allowed fields are counted even when they fail |
| `expires_at` | Optional. The expiry as ISO 8601 with a time zone, for example `2027-01-01T00:00:00Z`. Replace it with the expiry you need when operating |

While it is set, lists and title searches are also narrowed to the allowed items and shares. To leave no path for inferring disallowed content from note-body matching, `search_notes` is refused. The expiry is checked at the start of processing, after the authentication check, and before the result is returned, and no value is returned even if it expires midway. `session_status` can still report the connection state after expiry.

Without the environment variable, behavior is unchanged. The settings JSON must be UTF-8 and at most 64 KiB, with at most 1000 allowed items and 1 to 32 non-duplicate fields per item. Empty strings, invalid JSON, unknown settings, and duplicate allowed items are refused at startup. No MCP tool is provided that changes the permissions.

This restriction is meant to curb accidental or repeated reads through the MCP. The count is held per server process and resets on restart. It is not a mechanism to isolate someone who can rewrite the settings or run another CLI or MCP process, so combine it with Proton's access control.

A value read with `read_field` is handed to the AI. This MCP cannot prohibit the connected side from storing logs, nor erase an already read password when it expires. Even when using the file handoff, confirm the browser URL of the entry target in the Codex entry code.

### Disable the tool that returns plain text

`PROTON_PASS_DISABLE_SECRET_READ=1` stops registering `read_field`, which returns plain text to the conversation. With `0` or unset it is registered as before, and any other value refuses startup. `create_field_handoff` remains available, so file-based login from Codex still works with this setting. To narrow the targets and fields that can be read, use it together with `PROTON_PASS_ACCESS_POLICY`. This flag alone does not prohibit all secret retrieval.

## Installation

Node.js 22 or later is required. After installing the MCP server, you can install the official Proton `pass-cli` with the explicit `setup` command.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` fetches Proton's official stable manifest over HTTPS and downloads the official build for the current OS and CPU. It extracts and places it only if the SHA-256 in the manifest matches the actual file, and deletes temporary files except for the previous-version backup it points to when restoration is impossible. It does not log in, read or store a PAT, or change PATH.

When `PASS_CLI_PATH` is specified, MCP startup and `setup` without `--force` use only that executable. Even if the target is invalid, it does not fall back to the official default location or `PATH`, and fails for safety. When omitted, it looks for an existing CLI in the specified install directory (the official default location if unspecified), then in `PATH`, and does not download if one is found. To explicitly reinstall the stable version into the official default location, use `--force`, which skips the search for an existing CLI. To guarantee installation into an arbitrary location, use `--force` together with `--install-dir`.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

The official default locations are as follows.

| OS | Supported CPU | Location |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

For an unsupported OS or CPU, a changed manifest format, a dangerous download URL, an exceeded size limit, or a SHA-256 mismatch, it exits without overwriting the existing CLI. Proton's official distribution manifest and installer are available at [Proton Pass CLI](https://github.com/protonpass/pass-cli).

### Authenticate the CLI

`setup` and authentication are separate. Decide a session directory dedicated to the MCP, and run `pass-cli login` once with the same environment variable set.

Windows PowerShell example:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

macOS and Linux example:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

When using an existing `pass-cli` or when you specified `--install-dir`, set the absolute path of that executable in `PASS_CLI_PATH`. For details on authentication, see Proton's official [Pass CLI documentation](https://protonpass.github.io/pass-cli/).

### Register with an MCP client

Register the following stdio configuration with your MCP client. If `PASS_CLI_PATH` is omitted, the CLI is auto-detected from the default location or `PATH`, but specify it explicitly if you want to pin the CLI to run. On Windows, if the client cannot resolve `npx`, follow that client's instructions and specify `npx.cmd` or the absolute path of the installed server.

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

With `@latest`, the MCP client uses the latest npm version every time it starts the server. If you have already registered a pinned version such as `@kagayoi/proton-pass-mcp@1.0.12`, rewrite the registered start argument to `@kagayoi/proton-pass-mcp@latest` and it will automatically use the latest version from then on (updating this README alone does not change existing registrations). To pin a specific version, register it in this pinned-version form.

If you use auto-detection, you can delete the `PASS_CLI_PATH` line. For a custom CLI location, change it to the absolute path of that executable. The PAT is not stored in the settings file; the existing session is referenced. This server never saves secret bodies or raw CLI errors to logs. The result of a field read is handed to the connected client.

If a message says there is no valid session, set the same `PROTON_PASS_SESSION_DIR` as the MCP and check with `pass-cli info`. This message alone cannot tell whether the session expired, was revoked, or the storage location differs. If the location is correct and authentication is required, re-authenticate with `pass-cli login` for that location. An automatic logout explicitly reported by the CLI is announced with a different message. The MCP itself never logs out or stores tokens.

If `setup` cannot find an existing CLI and you specified `PASS_CLI_PATH`, check that the value points to the correct executable. If you use auto-detection, delete this variable and check whether the file exists in the official default location and whether `PATH` is visible from the current process. If extracting the Windows ZIP fails, check that Windows PowerShell is available and the state of the official download. If SHA-256 verification fails, do not disable the verification; rerun after Proton's manifest and the distribution match.

If an update fails midway, the existing files are restored automatically. If restoration also fails, do not delete the temporary backup shown in the error; stop the CLI and rerun, or put the files in the backup back into the install directory.

On Windows, even when `LOCALAPPDATA` is unset, an existing CLI from `PASS_CLI_PATH` or on `PATH` can be used. If the default location cannot be determined for a fresh install, set `LOCALAPPDATA` or specify the location with `setup --install-dir`.

## License

This MCP server is under the [MIT License](LICENSE). The Proton Pass CLI installed separately by `setup` follows Proton's [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE), and this npm package does not bundle the CLI binary.

For development and verification, see [CONTRIBUTING.md](CONTRIBUTING.md); for the structure of the system, see [DESIGN.md](DESIGN.md).
