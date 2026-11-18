# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **한국어** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

기존 `pass-cli` 인증 세션을 사용해 MCP 클라이언트에서 Proton Pass를 검색하는 로컬 MCP 서버입니다. Proton 공식 제품이 아닙니다.

Node.js를 사용하지 않으려면 Bun 1.4.4 이상을 설치하고, 아래의 `"command": "npx"` 와 `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` 를 각각 `"command": "bunx"` 와 `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]` 로 변경하세요(명령으로는 `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` 은 Node.js 대신 Bun으로 실행하기 위해 필요합니다. 기존 `npx` 설정도 Node.js 22 이상에서 계속 사용할 수 있습니다.

## 제공 기능

| 도구 | 용도 |
|---|---|
| `session_status` | 세션 연결 확인 |
| `list_vaults` | 보관함 이름과 공유 ID 목록 |
| `list_shares` | 허용된 공유 목록 |
| `list_items` | 제목으로 검색하고 항목 목록 조회 |
| `search_notes` | 텍스트 노트의 제목·본문 부분 문자열 검색(취득 제한 설정 중에는 사용 불가) |
| `create_field_handoff` | 값을 대화로 반환하지 않고 보호된 임시 파일에 대한 참조를 생성 |
| `release_field_handoff` | 사용하지 않았거나 실패한 전달을 회수 |
| `read_field` | 이유를 지정해 1개 필드를 취득. 항목·필드·유효 기간·빈도 제한 가능 |

`search_notes` 는 본문을 내부에서 대조하여 일치하는 제목·ID·상태만 반환합니다. 대소문자를 구분합니다. 첨부 파일은 검색 대상에 포함되지 않습니다. `state` 의 기본값은 `active` 이며, 휴지통을 포함하려면 `all` 을 지정합니다.

`list_vaults` 로 얻은 `share_id` 별로 검색하세요. `complete: false` 이면 같은 조건에 `next_cursor` 를 `cursor` 로 전달해 계속하고, 각 페이지의 `matches` 를 모으세요. 대상 목록이 도중에 바뀌면 처음부터 다시 검색합니다. 본문은 대조 시점의 값을 사용합니다.

`list_items` 의 제목 검색은 대소문자를 구분하지 않습니다. `next_offset` 이 있으면 그 값을 `offset` 으로 지정해 계속합니다.

`search_notes`·`read_field`·`create_field_handoff` 는 구체적인 요청·목적을 나타내는 `reason`(앞뒤 공백을 제외하고 5~300자, 유니코드 코드 포인트 수로 계산)이 필요합니다. `read_field` 는 요청한 값을 평문 도구 결과로 AI에 전달합니다. 연결된 서비스의 대화 기록·작업 로그에 남을 수 있으며, 이유 지정은 대화형 승인이나 로그 억제를 위한 장치가 아닙니다. Codex에서 대화에 값을 노출하지 않고 입력하려면 아래의 파일 전달을 사용하세요.

`read_field` 의 `field` 에는 공백·비ASCII 문자·섹션 이름을 포함한 이름(예: `Production.Password`)을 지정할 수 있습니다. 1~100자(유니코드 코드 포인트 수)이며 제어 문자는 사용할 수 없습니다.

### Codex에서 대화에 비밀번호를 노출하지 않고 로그인하기

MCP와 Codex의 브라우저 실행 환경이 같은 로컬 파일에 접근할 수 있을 때 사용할 수 있습니다. MCP가 반환하는 것은 `handoff_id`·`file_path`·`expires_at`·`consumer_module_url`·필드 이름뿐이며, 비밀번호 자체는 반환하지 않습니다.

1. 로그인 대상 URL과 대상 계정을 확인합니다.
2. `create_field_handoff` 에 공유 ID·항목 ID·필드 이름·이유를 전달합니다.
3. Codex의 브라우저 실행 코드에서 반환된 참조를 `withFieldHandoff` 에 전달해 입력합니다. 본문을 읽는 도구, `console.log`, `nodeRepl.write` 등에 값을 출력하지 마세요.
4. 사용하지 않고 중단한 경우 `release_field_handoff` 에 `handoff_id` 를 전달합니다. 입력 중 예외가 발생하면 보조 함수가 사용 후 삭제를 수행합니다. 이미 회수되었거나 알 수 없는 ID에 다시 실행해도 안전하지만, 해당 서버에서 확인할 수 없는 ID는 `{ released: false }` 를 반환합니다.

Codex 내장 브라우저를 조작하는 JavaScript 예시입니다. `receipt` 는 생성 도구가 반환한 참조이고, `tab` 은 확인된 브라우저 탭입니다. URL과 레이블은 실제 로그인 대상에 맞게 바꾸세요.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('로그인 대상이 변경되었습니다.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

보조 함수는 파일을 한 번만 가져올 수 있게 하고, 콜백의 성공·실패와 관계없이 사용 후 삭제합니다. 콜백의 반환값과 원본 예외도 외부로 반환하지 않습니다. 일반적인 반환값은 `{ consumed: true }` 입니다.

파일 전달은 1.0.10 이후에서 사용할 수 있습니다. 아래 설정으로 공개 버전을 실행합니다. `PROTON_PASS_DISABLE_SECRET_READ=1` 은 평문을 대화로 반환하는 `read_field` 만 비활성화하며, 파일 전달은 계속 사용할 수 있습니다. 기존 `PROTON_PASS_ACCESS_POLICY` 도 함께 사용할 수 있습니다.

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

| 임시 파일 설정 | 동작 |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | 유효 기간. 1~300초, 기본 60초. 취득 정책의 기한이 더 빠르면 그쪽을 우선 |
| `PROTON_PASS_HANDOFF_DIR` | 선택적인 보관 디렉터리. 기존 상위 디렉터리를 가진 정규화된 로컬 절대 경로여야 함. UNC와 루트 디렉터리 자체는 지정 불가. 미지정이면 사용자별 임시 영역 |

값을 취득하기 전에 Windows에서는 현재 사용자만 허용하는 ACL, POSIX에서는 소유자 전용 디렉터리·파일 권한을 확인합니다. 기존 영역의 권한이 안전하지 않거나 링크가 감지되면 거부합니다. 권한을 자동으로 완화하거나 수정하지 않습니다.

사용하지 않은 파일은 기한이 되면 회수하며, MCP 서버 종료 시에도 회수합니다. 서버가 갑자기 종료되면 감시 프로세스가 회수합니다. OS 정지 등으로 둘 다 동작하지 못한 경우 다음 시작 시 기한이 지난 것을 회수하고, 소유 서버의 정지를 확인할 수 있는 것은 기한 전이라도 회수합니다. 삭제에 실패하면 성공으로 처리하지 않고 기한 회수를 계속합니다. 시작 시 기존 영역의 검증·회수에 실패하면 시작을 거부하므로 보관 위치와 액세스 권한을 확인하세요.

이 방식은 값이 대화로 노출되는 경로를 줄일 수 있지만, 로컬 파일·실행 메모리·브라우저 안에는 평문이 존재합니다. 같은 OS 사용자나 관리자로부터의 격리, 메모리나 디스크의 복구 불가능한 삭제, 실행 환경의 모든 내부 로그에 저장되지 않는 것은 보장하지 않습니다. Grok Bot처럼 파일에서 직접 입력할 수 없는 클라이언트에서는 이 방식의 자동 입력을 할 수 없습니다.

### 로그인에 사용하면서 취득 범위 제한하기

먼저 Proton 측에서 에이전트 전용 PAT에 **필요한 항목만, viewer(읽기 전용), 짧은 유효 기간**을 설정하고, 그 PAT로 인증한 전용 세션을 사용하는 것을 권장합니다. 보관함 전체를 허용하면 그 안의 모든 항목이 접근 대상이 됩니다. PAT의 생성·기한·권한은 [Proton 공식 액세스 제어](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control)를 참조하세요. 이 MCP는 PAT나 기존 세션의 권한을 자동으로 변경하지 않습니다.

MCP 측에서도 `PROTON_PASS_ACCESS_POLICY` 에 다음과 같은 JSON을 지정할 수 있습니다. 지정한 계정의 `username`·`password`·`totp` 는 계속 취득할 수 있으며, 허용되지 않은 항목이나 필드는 CLI를 호출하기 전에 거부합니다.

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

`SHARE_ID`·`ITEM_ID` 는 `list_vaults` / `list_shares` / `list_items` 로 확인해 바꾸세요. `fields` 는 저장된 항목에서 사용하는 정확한 필드 이름입니다. 설정을 변경한 후에는 MCP 서버를 다시 시작하세요.

취득 제한은 1.0.10 이후에서 사용할 수 있습니다. 아래 설정으로 공개 버전을 실행합니다. 경로와 ID는 자신의 위치와 허용할 항목으로 바꾸세요.

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

| 설정 항목 | 동작 |
|---|---|
| `allowed_items` | 필수. 공유 ID·항목 ID·필드 이름의 완전 일치로 허용. 빈 배열이면 허용 항목이 없고 목록도 비어 있음 |
| `max_reads_per_minute` | 최근 60초의 취득 시도 상한. 1~1000, 기본 10. 허용된 필드에 대한 CLI 시도는 실패해도 집계 |
| `expires_at` | 선택. 유효 기간을 시간대가 있는 ISO 8601로 지정. 예: `2027-01-01T00:00:00Z`. 운영 시에는 필요한 기한으로 바꾸세요 |

설정 중에는 목록·제목 검색도 허용된 항목과 공유로 좁혀집니다. 노트 본문 대조로 허용되지 않은 내용을 추측하는 경로를 남기지 않기 위해 `search_notes` 는 거부합니다. 기한은 처리 시작 시, 인증 확인 후, 결과 반환 전에 확인하며, 도중에 만료되어도 값을 반환하지 않습니다. `session_status` 는 만료 후에도 연결 상태를 확인할 수 있습니다.

환경 변수가 설정되지 않으면 기존과 같이 사용할 수 있습니다. 설정 JSON은 UTF-8로 64 KiB 이내여야 하며, 허용 항목은 최대 1000개, 각 항목의 필드는 중복 없는 1~32개입니다. 빈 문자열, 잘못된 JSON, 알 수 없는 설정 항목, 중복된 허용 항목 등은 시작을 거부합니다. 허용을 변경하는 MCP 도구는 제공하지 않습니다.

이 제한은 MCP를 통한 잘못된 취득이나 연속 취득을 억제하기 위한 것입니다. 횟수는 서버 프로세스별로 유지하며 재시작하면 초기화됩니다. 설정을 고쳐 쓰거나 다른 CLI·MCP 프로세스를 실행할 수 있는 상대를 격리하는 장치는 아니므로 Proton 측의 액세스 제어와 함께 사용하세요.

`read_field` 로 취득한 값은 AI에 전달됩니다. 연결된 서비스의 로그 저장을 이 MCP에서 금지하거나, 이미 취득한 비밀번호를 기한 만료로 지울 수는 없습니다. 파일 전달을 사용할 때도 입력 대상의 브라우저 URL은 Codex의 입력 코드에서 확인하세요.

### 평문을 반환하는 취득 도구 비활성화하기

`PROTON_PASS_DISABLE_SECRET_READ=1` 은 평문을 대화로 반환하는 `read_field` 를 등록하지 않는 설정입니다. `0` 이거나 미설정이면 기존과 같이 등록하고, 그 밖의 값은 시작을 거부합니다. `create_field_handoff` 는 계속 사용할 수 있으므로 이 설정 그대로 Codex에서 파일을 통한 로그인이 가능합니다. 취득할 수 있는 대상·필드를 좁히려면 `PROTON_PASS_ACCESS_POLICY` 를 함께 사용하세요. 이 플래그만으로 모든 비밀 취득을 금지하는 것은 아닙니다.

## 설치

Node.js 22 이상이 필요합니다. MCP 서버를 설치한 후 명시적인 `setup` 명령으로 Proton 공식 `pass-cli` 를 설치할 수 있습니다.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` 은 Proton 공식 stable 매니페스트를 HTTPS로 가져와 현재 OS·CPU에 맞는 공식 배포 파일을 다운로드합니다. 매니페스트에 기재된 SHA-256과 실제 파일이 일치할 때만 압축을 풀어 배치하며, 복원할 수 없을 때 안내하는 이전 버전 백업을 제외하고 임시 파일을 삭제합니다. 로그인, PAT의 읽기·저장, PATH 변경은 하지 않습니다.

`PASS_CLI_PATH` 를 지정하면 MCP 시작과 `--force` 없는 `setup` 은 그 실행 파일만 사용합니다. 지정한 위치가 올바르지 않아도 공식 기본 위치나 `PATH` 로 대체하지 않고 안전을 위해 실패합니다. 생략하면 지정한 설치 위치(미지정이면 공식 기본 위치), `PATH` 순으로 기존 CLI를 찾고, 발견되면 다운로드하지 않습니다. stable 버전을 공식 기본 위치에 명시적으로 다시 설치하려면 기존 CLI 탐색을 생략하는 `--force` 를 사용합니다. 임의의 위치에 설치를 보장하려면 `--force` 와 `--install-dir` 를 함께 사용하세요.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

공식 기본 위치는 다음과 같습니다.

| OS | 지원 CPU | 위치 |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

지원하지 않는 OS·CPU, 매니페스트 형식 변경, 위험한 다운로드 URL, 크기 상한 초과, SHA-256 불일치의 경우 기존 CLI를 덮어쓰지 않고 종료합니다. Proton 공식 배포 매니페스트와 설치 프로그램은 [Proton Pass CLI](https://github.com/protonpass/pass-cli) 에서 확인할 수 있습니다.

### CLI 인증하기

`setup` 과 인증은 분리되어 있습니다. MCP 전용 세션 디렉터리를 정하고, 같은 환경 변수를 설정한 상태에서 `pass-cli login` 을 한 번 실행하세요.

Windows PowerShell 예시:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

macOS·Linux 예시:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

기존 `pass-cli` 를 사용하거나 `--install-dir` 를 지정한 경우에는 그 실행 파일의 절대 경로를 `PASS_CLI_PATH` 에 설정합니다. 인증 방법의 자세한 내용은 Proton 공식 [Pass CLI 문서](https://protonpass.github.io/pass-cli/)를 참조하세요.

### MCP 클라이언트에 등록하기

MCP 클라이언트에는 다음 stdio 설정을 등록합니다. `PASS_CLI_PATH` 를 생략하면 기본 위치나 `PATH` 에서 자동 감지되지만, 실행할 CLI를 고정하려면 명시하세요. Windows에서 클라이언트가 `npx` 를 찾지 못하면 해당 클라이언트의 절차에 따라 `npx.cmd` 또는 설치된 서버의 절대 경로를 지정하세요.

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

`@latest` 를 지정하면 MCP 클라이언트가 서버를 시작할 때마다 npm의 최신 버전을 사용합니다. 이미 `@kagayoi/proton-pass-mcp@1.0.14` 과 같은 고정 버전으로 등록했다면, 등록된 시작 인수를 `@kagayoi/proton-pass-mcp@latest` 로 바꾸면 이후 자동으로 최신 버전이 됩니다(README를 갱신하는 것만으로는 기존 등록이 바뀌지 않습니다). 특정 버전으로 고정하려면 이 고정 버전 형식으로 등록하세요.

자동 감지를 사용하는 경우 `PASS_CLI_PATH` 줄을 삭제할 수 있습니다. 독자적인 CLI 위치라면 그 실행 파일의 절대 경로로 변경하세요. PAT는 설정 파일에 저장하지 않고 기존 세션을 참조합니다. 비밀 본문이나 CLI의 원본 오류를 이 서버가 로그에 저장하는 일은 없습니다. 필드 취득 결과는 연결된 클라이언트에 전달됩니다.

"유효한 세션이 없습니다"라고 표시되면 MCP와 같은 `PROTON_PASS_SESSION_DIR` 를 설정하고 `pass-cli info` 로 확인하세요. 이 표시만으로는 만료·실효·보관 위치 차이를 구분할 수 없습니다. 보관 위치가 올바르고 인증이 필요하다면 그 위치에서 `pass-cli login` 으로 다시 인증하세요. CLI가 명시한 자동 로그아웃은 다른 메시지로 알립니다. MCP 자체는 로그아웃이나 토큰 저장을 하지 않습니다.

`setup` 이 기존 CLI를 찾지 못하면, `PASS_CLI_PATH` 를 지정했다면 그 값이 올바른 실행 파일을 가리키는지 확인하세요. 자동 감지를 사용한다면 이 변수를 삭제하고, 공식 기본 위치에 파일이 있는지, 현재 프로세스에서 `PATH` 가 보이는지 확인하세요. Windows ZIP 압축 해제에 실패하면 Windows PowerShell을 사용할 수 있는지와 공식 배포 파일의 취득 상태를 확인하세요. SHA-256 검증에 실패하면 검증을 비활성화하지 말고, 공식 매니페스트와 배포 파일이 일치한 후 다시 실행하세요.

업데이트 도중 실패하면 기존 파일을 자동으로 복원합니다. 복원도 실패하면 오류에 표시된 임시 백업을 삭제하지 말고, CLI를 중지한 뒤 다시 실행하거나 백업 안의 파일을 설치 위치로 되돌리세요.

Windows에서 `LOCALAPPDATA` 가 설정되지 않아도 `PASS_CLI_PATH` 또는 `PATH` 상의 기존 CLI를 사용할 수 있습니다. 새로 설치할 때 기본 위치를 결정할 수 없다면 `LOCALAPPDATA` 를 설정하거나 `setup --install-dir` 로 위치를 지정하세요.

## 라이선스

이 MCP 서버는 [MIT License](LICENSE) 입니다. `setup` 으로 별도 설치하는 Proton Pass CLI는 Proton의 [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE)를 따르며, 이 npm 패키지에는 CLI 바이너리를 포함하지 않습니다.

개발·검증은 [CONTRIBUTING.md](CONTRIBUTING.md), 시스템 구조는 [DESIGN.md](DESIGN.md) 를 참조하세요.
