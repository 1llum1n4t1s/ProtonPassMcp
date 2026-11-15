# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | **Português (Brasil)**

Servidor MCP local que permite a um cliente MCP pesquisar no Proton Pass por meio de uma sessão autenticada existente do `pass-cli`. Não é um produto oficial da Proton.

Para não usar Node.js, instale o Bun 1.4.4 ou posterior e altere `"command": "npx"` e `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` abaixo para `"command": "bunx"` e `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]`, respectivamente (como comando: `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` é necessário para executar com o Bun em vez do Node.js. As configurações `npx` existentes também continuam funcionando com Node.js 22 ou posterior.

## Recursos

| Ferramenta | Finalidade |
|---|---|
| `session_status` | Verificar a conexão da sessão |
| `list_vaults` | Lista de nomes de cofres e IDs de compartilhamento |
| `list_shares` | Lista dos compartilhamentos permitidos |
| `list_items` | Pesquisar por título e listar itens |
| `search_notes` | Pesquisa de substring no título e no corpo de notas de texto (indisponível enquanto houver restrição de leitura configurada) |
| `create_field_handoff` | Criar uma referência a um arquivo temporário protegido sem devolver o valor à conversa |
| `release_field_handoff` | Recuperar entregas não usadas ou com falha |
| `read_field` | Ler um campo informando um motivo. Itens, campos, validade e frequência podem ser restringidos |

`search_notes` compara os corpos internamente e devolve apenas os títulos, IDs e estados correspondentes. Diferencia maiúsculas de minúsculas. Anexos não são pesquisados. O padrão de `state` é `active`; especifique `all` para incluir a lixeira.

Pesquise por cada `share_id` obtido de `list_vaults`. Se `complete: false`, continue com os mesmos critérios passando `next_cursor` como `cursor` e reúna os `matches` de todas as páginas. Se a lista de destino mudar no meio do caminho, pesquise de novo desde o início. Os corpos são comparados com o valor que têm no momento da comparação.

A pesquisa por título de `list_items` não diferencia maiúsculas de minúsculas. Se houver `next_offset`, continue informando-o como `offset`.

`search_notes`, `read_field` e `create_field_handoff` exigem um `reason` (de 5 a 300 caracteres após remover os espaços das extremidades, contados em pontos de código Unicode) que indique a solicitação ou finalidade concreta. `read_field` entrega o valor solicitado à IA como resultado de ferramenta em texto simples. Ele pode permanecer no histórico de conversa e nos registros de trabalho do serviço conectado, e informar um motivo não é um mecanismo de aprovação interativa nem de supressão de registros. Para inserir um valor no Codex sem mostrá-lo na conversa, use a entrega por arquivo abaixo.

O `field` de `read_field` pode ser um nome com espaços, caracteres não ASCII ou um nome de seção (por exemplo `Production.Password`). Deve ter de 1 a 100 caracteres (em pontos de código Unicode) e não pode conter caracteres de controle.

### Fazer login pelo Codex sem mostrar a senha na conversa

Funciona quando o MCP e o ambiente de execução do navegador do Codex conseguem acessar os mesmos arquivos locais. O MCP devolve apenas `handoff_id`, `file_path`, `expires_at`, `consumer_module_url` e o nome do campo. Ele nunca devolve a senha em si.

1. Confirme a URL de login e a conta de destino.
2. Passe o ID de compartilhamento, o ID do item, o nome do campo e o motivo para `create_field_handoff`.
3. No código de execução do navegador do Codex, passe a referência devolvida para `withFieldHandoff` para inserir o valor. Não envie o valor a ferramentas que leem o corpo, a `console.log`, a `nodeRepl.write` etc.
4. Se cancelar sem usar, passe o `handoff_id` para `release_field_handoff`. Se a inserção lançar uma exceção, a função auxiliar exclui o arquivo após o uso. Executar novamente para um ID já recuperado ou desconhecido é seguro, mas um ID que este servidor não consiga confirmar devolve `{ released: false }`.

Veja um exemplo em JavaScript que controla o navegador integrado do Codex. `receipt` é a referência devolvida pela ferramenta de criação e `tab` é uma aba de navegador confirmada. Ajuste a URL e o rótulo ao destino real do login.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('O destino do login mudou.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

A função auxiliar permite obter o arquivo apenas uma vez e o exclui após o uso, quer o callback tenha sucesso ou falhe. Ela também não devolve o valor de retorno do callback nem exceções brutas. O valor de retorno normal é `{ consumed: true }`.

A entrega por arquivo está disponível a partir da versão 1.0.10. Inicie a versão publicada com a configuração abaixo. `PROTON_PASS_DISABLE_SECRET_READ=1` desativa apenas `read_field`, que devolve texto simples à conversa; a entrega por arquivo continua disponível. Um `PROTON_PASS_ACCESS_POLICY` existente pode ser usado em conjunto.

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

| Configuração de arquivos temporários | Comportamento |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | Validade. De 1 a 300 segundos, padrão 60. Se a política de acesso expirar antes, ela tem precedência |
| `PROTON_PASS_HANDOFF_DIR` | Diretório de armazenamento opcional. Deve ser um caminho absoluto local normalizado com um diretório pai existente. Caminhos UNC e o próprio diretório raiz não são permitidos. Se não for definido, usa-se uma área temporária por usuário |

Antes de armazenar um valor, o servidor verifica uma ACL que permita apenas o usuário atual no Windows e permissões de diretório e arquivo exclusivas do proprietário no POSIX. Ele recusa se uma área existente tiver permissões inseguras ou se um link for detectado. Nunca afrouxa nem repara permissões automaticamente.

Os arquivos não usados são recuperados na expiração e quando o servidor MCP é encerrado. Se o servidor terminar abruptamente, um processo de monitoramento os recupera. Se nenhum dos dois pôde ser executado (por exemplo, porque o sistema operacional parou), a próxima inicialização recupera os expirados e também aqueles cujo servidor proprietário esteja confirmadamente parado, mesmo antes da expiração. Uma exclusão que falha não é tratada como sucesso, e a limpeza por expiração continua. Se a validação ou a recuperação da área existente falhar na inicialização, a inicialização é recusada; verifique o local de armazenamento e os direitos de acesso.

Essa abordagem reduz os caminhos pelos quais um valor chega à conversa, mas existe texto simples em arquivos locais, na memória de execução e no navegador. Ela não garante isolamento do mesmo usuário do sistema operacional nem de administradores, apagamento irrecuperável da memória ou do disco, nem que nada seja armazenado em registros internos do ambiente de execução. Clientes que não conseguem digitar diretamente a partir de um arquivo, como o Grok Bot, não podem usar essa abordagem para entrada automática.

### Fazer login restringindo o que pode ser lido

No lado da Proton, recomenda-se primeiro criar um PAT exclusivo do agente com **somente os itens necessários, viewer (somente leitura) e validade curta**, e usar uma sessão dedicada autenticada com esse PAT. Permitir um cofre inteiro torna todos os itens dele acessíveis. Para criar o PAT, definir sua validade e permissões, consulte o [controle de acesso oficial da Proton](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control). Este MCP nunca altera automaticamente as permissões de um PAT ou de uma sessão existente.

No lado do MCP, você também pode definir em `PROTON_PASS_ACCESS_POLICY` um JSON como o seguinte. `username`, `password` e `totp` da conta indicada continuam podendo ser lidos, e itens ou campos não permitidos são recusados antes de chamar a CLI.

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

Substitua `SHARE_ID` e `ITEM_ID` por valores confirmados com `list_vaults` / `list_shares` / `list_items`. `fields` são os nomes exatos dos campos usados pelo item armazenado. Reinicie o servidor MCP depois de alterar as configurações.

A restrição de acesso está disponível a partir da versão 1.0.10. Inicie a versão publicada com a configuração abaixo. Substitua os caminhos e os IDs pelo seu próprio local e pelos itens que você permite.

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

| Configuração | Comportamento |
|---|---|
| `allowed_items` | Obrigatório. Permitido por correspondência exata de ID de compartilhamento, ID do item e nome do campo. Um array vazio significa nenhum item permitido e lista vazia |
| `max_reads_per_minute` | Limite de tentativas de leitura nos últimos 60 segundos. De 1 a 1000, padrão 10. Tentativas da CLI em campos permitidos são contadas mesmo quando falham |
| `expires_at` | Opcional. A validade em ISO 8601 com fuso horário, por exemplo `2027-01-01T00:00:00Z`. Substitua pela validade necessária ao operar |

Enquanto estiver configurada, listas e pesquisas por título também ficam restritas aos itens e compartilhamentos permitidos. Para não deixar nenhum caminho que permita inferir conteúdo não permitido a partir das correspondências no corpo das notas, `search_notes` é recusado. A validade é verificada no início do processamento, após a verificação de autenticação e antes de devolver o resultado, e nenhum valor é devolvido mesmo que expire no meio. `session_status` ainda pode informar o estado da conexão após a expiração.

Sem a variável de ambiente, o comportamento não muda. O JSON de configuração deve estar em UTF-8 e ter no máximo 64 KiB, com no máximo 1000 itens permitidos e de 1 a 32 campos não duplicados por item. Strings vazias, JSON inválido, configurações desconhecidas e itens permitidos duplicados são recusados na inicialização. Nenhuma ferramenta MCP que altere as permissões é fornecida.

Essa restrição serve para conter leituras acidentais ou repetidas pelo MCP. A contagem é mantida por processo do servidor e reinicia ao reiniciar. Não é um mecanismo para isolar quem possa reescrever as configurações ou executar outro processo da CLI ou do MCP, portanto combine-a com o controle de acesso da Proton.

Um valor lido com `read_field` é entregue à IA. Este MCP não pode proibir que o lado conectado armazene registros nem apagar uma senha já lida quando ela expira. Mesmo ao usar a entrega por arquivo, confirme a URL do navegador do destino de entrada no código de entrada do Codex.

### Desativar a ferramenta que devolve texto simples

`PROTON_PASS_DISABLE_SECRET_READ=1` deixa de registrar `read_field`, que devolve texto simples à conversa. Com `0` ou sem definir, ele é registrado como antes, e qualquer outro valor recusa a inicialização. `create_field_handoff` continua disponível, então o login por arquivo a partir do Codex ainda funciona com essa configuração. Para restringir os destinos e campos que podem ser lidos, use-o em conjunto com `PROTON_PASS_ACCESS_POLICY`. Esse sinalizador sozinho não proíbe toda obtenção de segredos.

## Instalação

É necessário Node.js 22 ou posterior. Depois de instalar o servidor MCP, você pode instalar o `pass-cli` oficial da Proton com o comando explícito `setup`.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` obtém por HTTPS o manifesto stable oficial da Proton e baixa a distribuição oficial correspondente ao sistema operacional e à CPU atuais. Só a extrai e a coloca no lugar se o SHA-256 do manifesto coincidir com o arquivo real, e exclui os arquivos temporários, exceto o backup da versão anterior indicado quando a restauração é impossível. Não faz login, não lê nem armazena PAT e não altera o PATH.

Quando `PASS_CLI_PATH` é informado, a inicialização do MCP e o `setup` sem `--force` usam apenas esse executável. Mesmo que o destino seja inválido, não recorrem ao local padrão oficial nem ao `PATH`, e falham por segurança. Se omitido, procura uma CLI existente no diretório de instalação informado (o local padrão oficial se não informado) e depois no `PATH`, e não baixa nada se encontrar uma. Para reinstalar explicitamente a versão stable no local padrão oficial, use `--force`, que ignora a busca por uma CLI existente. Para garantir a instalação em um local arbitrário, use `--force` junto com `--install-dir`.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

Os locais padrão oficiais são os seguintes.

| SO | CPU compatível | Local |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

Em caso de SO ou CPU não compatível, formato de manifesto alterado, URL de download perigosa, limite de tamanho excedido ou SHA-256 divergente, ele termina sem sobrescrever a CLI existente. O manifesto de distribuição e o instalador oficiais da Proton estão em [Proton Pass CLI](https://github.com/protonpass/pass-cli).

### Autenticar a CLI

`setup` e autenticação são separados. Defina um diretório de sessão dedicado ao MCP e execute `pass-cli login` uma vez com a mesma variável de ambiente definida.

Exemplo no Windows PowerShell:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

Exemplo no macOS e Linux:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

Se usar um `pass-cli` existente ou tiver informado `--install-dir`, defina em `PASS_CLI_PATH` o caminho absoluto desse executável. Para detalhes sobre a autenticação, consulte a [documentação do Pass CLI](https://protonpass.github.io/pass-cli/) oficial da Proton.

### Registrar em um cliente MCP

Registre a seguinte configuração stdio no seu cliente MCP. Se `PASS_CLI_PATH` for omitido, a CLI é detectada automaticamente no local padrão ou no `PATH`, mas informe-o explicitamente se quiser fixar a CLI executada. No Windows, se o cliente não conseguir resolver `npx`, siga as instruções desse cliente e informe `npx.cmd` ou o caminho absoluto do servidor instalado.

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

Com `@latest`, o cliente MCP usa a versão mais recente do npm toda vez que inicia o servidor. Se você já registrou uma versão fixa como `@kagayoi/proton-pass-mcp@1.0.12`, reescreva o argumento de inicialização registrado para `@kagayoi/proton-pass-mcp@latest` e a partir daí ele usará automaticamente a versão mais recente (atualizar apenas este README não altera os registros existentes). Para fixar uma versão específica, registre-a neste formato de versão fixa.

Se usar a detecção automática, pode excluir a linha `PASS_CLI_PATH`. Para um local de CLI personalizado, altere-a para o caminho absoluto desse executável. O PAT não é armazenado no arquivo de configuração; a sessão existente é referenciada. Este servidor nunca grava corpos secretos nem erros brutos da CLI nos registros. O resultado da leitura de um campo é entregue ao cliente conectado.

Se uma mensagem indicar que não há sessão válida, defina o mesmo `PROTON_PASS_SESSION_DIR` do MCP e verifique com `pass-cli info`. Essa mensagem por si só não permite saber se a sessão expirou, foi revogada ou se o local de armazenamento é diferente. Se o local estiver correto e for necessária autenticação, autentique-se novamente com `pass-cli login` para esse local. Um logout automático informado explicitamente pela CLI é comunicado com outra mensagem. O próprio MCP nunca faz logout nem armazena tokens.

Se o `setup` não encontrar uma CLI existente e você tiver informado `PASS_CLI_PATH`, verifique se o valor aponta para o executável correto. Se usar a detecção automática, exclua essa variável e verifique se o arquivo existe no local padrão oficial e se o `PATH` é visível a partir do processo atual. Se a extração do ZIP do Windows falhar, verifique se o Windows PowerShell está disponível e o estado do download oficial. Se a verificação do SHA-256 falhar, não a desative; execute novamente quando o manifesto da Proton e a distribuição coincidirem.

Se uma atualização falhar no meio, os arquivos existentes são restaurados automaticamente. Se a restauração também falhar, não exclua o backup temporário mostrado no erro; pare a CLI e execute novamente, ou devolva os arquivos do backup ao diretório de instalação.

No Windows, mesmo que `LOCALAPPDATA` não esteja definida, é possível usar uma CLI existente indicada em `PASS_CLI_PATH` ou presente no `PATH`. Se em uma instalação nova não for possível determinar o local padrão, defina `LOCALAPPDATA` ou informe o local com `setup --install-dir`.

## Licença

Este servidor MCP é distribuído sob a [MIT License](LICENSE). O Proton Pass CLI instalado separadamente pelo `setup` segue a [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE) da Proton, e este pacote npm não inclui o binário da CLI.

Para desenvolvimento e verificação, consulte [CONTRIBUTING.md](CONTRIBUTING.md); para a estrutura do sistema, consulte [DESIGN.md](DESIGN.md).
