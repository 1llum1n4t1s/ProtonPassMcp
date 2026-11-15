# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Servidor MCP local que permite a un cliente MCP buscar en Proton Pass mediante una sesión autenticada existente de `pass-cli`. No es un producto oficial de Proton.

Si no desea usar Node.js, instale Bun 1.4.4 o posterior y cambie `"command": "npx"` y `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` de más abajo por `"command": "bunx"` y `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]` respectivamente (como comando: `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` es necesario para ejecutar con Bun en lugar de Node.js. Las configuraciones existentes con `npx` también siguen funcionando con Node.js 22 o posterior.

## Funciones

| Herramienta | Uso |
|---|---|
| `session_status` | Comprobar la conexión de la sesión |
| `list_vaults` | Lista de nombres de bóvedas e ID de recurso compartido |
| `list_shares` | Lista de los recursos compartidos permitidos |
| `list_items` | Buscar por título y listar elementos |
| `search_notes` | Búsqueda de subcadenas en el título y el cuerpo de las notas de texto (no disponible mientras haya una restricción de lectura configurada) |
| `create_field_handoff` | Crear una referencia a un archivo temporal protegido sin devolver el valor a la conversación |
| `release_field_handoff` | Recuperar entregas sin usar o fallidas |
| `read_field` | Leer un campo indicando un motivo. Se pueden restringir elementos, campos, caducidad y frecuencia |

`search_notes` compara los cuerpos internamente y devuelve solo los títulos, ID y estados coincidentes. Distingue mayúsculas de minúsculas. No busca en los adjuntos. El valor predeterminado de `state` es `active`; indique `all` para incluir la papelera.

Busque por cada `share_id` obtenido con `list_vaults`. Si `complete: false`, continúe con los mismos criterios pasando `next_cursor` como `cursor` y reúna los `matches` de todas las páginas. Si la lista de destino cambia a mitad de la búsqueda, empiece de nuevo. Los cuerpos se comparan con el valor que tienen en ese momento.

La búsqueda por título de `list_items` no distingue mayúsculas de minúsculas. Si hay `next_offset`, continúe indicándolo como `offset`.

`search_notes`, `read_field` y `create_field_handoff` requieren un `reason` (de 5 a 300 caracteres tras quitar los espacios de los extremos, contados en puntos de código Unicode) que indique la solicitud o finalidad concreta. `read_field` entrega el valor solicitado a la IA como resultado de herramienta en texto plano. Puede quedar en el historial de conversación y en los registros de trabajo del servicio conectado, y indicar un motivo no es un mecanismo de aprobación interactiva ni de supresión de registros. Para introducir un valor en Codex sin mostrarlo en la conversación, use la entrega por archivo descrita a continuación.

El `field` de `read_field` puede ser un nombre con espacios, caracteres no ASCII o un nombre de sección (por ejemplo `Production.Password`). Debe tener de 1 a 100 caracteres (en puntos de código Unicode) y no puede contener caracteres de control.

### Iniciar sesión desde Codex sin mostrar la contraseña en la conversación

Funciona cuando el MCP y el entorno de ejecución del navegador de Codex pueden acceder a los mismos archivos locales. El MCP devuelve únicamente `handoff_id`, `file_path`, `expires_at`, `consumer_module_url` y el nombre del campo. Nunca devuelve la contraseña.

1. Confirme la URL de inicio de sesión y la cuenta de destino.
2. Pase el ID de recurso compartido, el ID del elemento, el nombre del campo y el motivo a `create_field_handoff`.
3. En el código de ejecución del navegador de Codex, pase la referencia devuelta a `withFieldHandoff` para introducir el valor. No envíe el valor a herramientas que lean el cuerpo, `console.log`, `nodeRepl.write`, etc.
4. Si lo cancela sin usarlo, pase el `handoff_id` a `release_field_handoff`. Si la introducción lanza una excepción, la función auxiliar elimina el archivo tras su uso. Repetirlo con un ID ya recuperado o desconocido es seguro, pero un ID que este servidor no pueda confirmar devuelve `{ released: false }`.

Este es un ejemplo en JavaScript que controla el navegador integrado de Codex. `receipt` es la referencia devuelta por la herramienta de creación y `tab` es una pestaña del navegador confirmada. Ajuste la URL y la etiqueta al destino real de inicio de sesión.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('El destino de inicio de sesión ha cambiado.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

La función auxiliar permite obtener el archivo una sola vez y lo elimina tras su uso, tanto si el callback tiene éxito como si falla. Tampoco devuelve el valor de retorno del callback ni las excepciones sin procesar. El valor de retorno normal es `{ consumed: true }`.

La entrega por archivo está disponible desde la versión 1.0.10. Inicie la versión publicada con la configuración siguiente. `PROTON_PASS_DISABLE_SECRET_READ=1` desactiva únicamente `read_field`, que devuelve texto plano a la conversación; la entrega por archivo sigue disponible. Puede combinarse con un `PROTON_PASS_ACCESS_POLICY` existente.

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

| Ajuste de archivos temporales | Comportamiento |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | Caducidad. De 1 a 300 segundos, 60 por defecto. Si la política de acceso caduca antes, prevalece esta |
| `PROTON_PASS_HANDOFF_DIR` | Directorio de almacenamiento opcional. Debe ser una ruta absoluta local normalizada con un directorio padre existente. No se admiten rutas UNC ni el directorio raíz. Si no se indica, se usa un área temporal por usuario |

Antes de guardar un valor, el servidor comprueba una ACL que permita solo al usuario actual en Windows, y permisos de directorio y archivo exclusivos del propietario en POSIX. Rechaza el área si sus permisos no son seguros o si detecta un enlace. Nunca relaja ni repara los permisos automáticamente.

Los archivos sin usar se recuperan al caducar y cuando el servidor MCP termina. Si el servidor termina de forma abrupta, un proceso vigilante los recupera. Si ninguno de los dos pudo ejecutarse (por ejemplo, porque el sistema operativo se detuvo), el siguiente inicio recupera los caducados y también aquellos cuyo servidor propietario se confirme detenido, incluso antes de que caduquen. Un borrado fallido no se considera correcto y la recuperación por caducidad continúa. Si al iniciar falla la validación o la recuperación del área existente, se rechaza el inicio, así que compruebe la ubicación de almacenamiento y los permisos.

Este método reduce las vías por las que un valor llega a la conversación, pero existe texto plano en archivos locales, en la memoria de ejecución y en el navegador. No garantiza aislamiento frente al mismo usuario del sistema operativo ni frente a administradores, el borrado irrecuperable de la memoria o del disco, ni que no se guarde nada en los registros internos del entorno de ejecución. Los clientes que no pueden escribir directamente desde un archivo, como Grok Bot, no pueden usar este método para la entrada automática.

### Iniciar sesión restringiendo lo que se puede leer

En el lado de Proton, se recomienda crear primero un PAT exclusivo para el agente con **solo los elementos necesarios, viewer (solo lectura) y una caducidad corta**, y usar una sesión dedicada autenticada con ese PAT. Permitir una bóveda completa hace accesibles todos sus elementos. Para crear el PAT, su caducidad y sus permisos, consulte el [control de acceso oficial de Proton](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control). Este MCP nunca cambia automáticamente los permisos de un PAT ni de una sesión existente.

En el lado del MCP, también puede indicar en `PROTON_PASS_ACCESS_POLICY` un JSON como el siguiente. `username`, `password` y `totp` de la cuenta indicada siguen pudiendo leerse, y los elementos o campos no permitidos se rechazan antes de llamar a la CLI.

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

Sustituya `SHARE_ID` e `ITEM_ID` por los valores confirmados con `list_vaults` / `list_shares` / `list_items`. `fields` son los nombres exactos de los campos usados por el elemento guardado. Reinicie el servidor MCP tras cambiar la configuración.

La restricción de acceso está disponible desde la versión 1.0.10. Inicie la versión publicada con la configuración siguiente. Sustituya las rutas y los ID por su propia ubicación y por los elementos que permita.

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

| Ajuste | Comportamiento |
|---|---|
| `allowed_items` | Obligatorio. Se permite por coincidencia exacta de ID de recurso compartido, ID de elemento y nombre de campo. Un arreglo vacío significa que no hay elementos permitidos y la lista queda vacía |
| `max_reads_per_minute` | Límite de intentos de lectura en los últimos 60 segundos. De 1 a 1000, 10 por defecto. Los intentos de la CLI sobre campos permitidos se cuentan aunque fallen |
| `expires_at` | Opcional. La caducidad en ISO 8601 con zona horaria, por ejemplo `2027-01-01T00:00:00Z`. Sustitúyala por la caducidad que necesite al operar |

Mientras está configurada, las listas y las búsquedas por título también se limitan a los elementos y recursos compartidos permitidos. Para no dejar ninguna vía que permita deducir contenido no permitido a partir de las coincidencias en el cuerpo de las notas, `search_notes` se rechaza. La caducidad se comprueba al empezar el procesamiento, tras la comprobación de autenticación y antes de devolver el resultado, y no se devuelve ningún valor aunque caduque a mitad. `session_status` puede seguir informando del estado de la conexión tras la caducidad.

Sin la variable de entorno, el comportamiento no cambia. El JSON de configuración debe estar en UTF-8 y tener como máximo 64 KiB, con como máximo 1000 elementos permitidos y de 1 a 32 campos no duplicados por elemento. Las cadenas vacías, el JSON no válido, los ajustes desconocidos y los elementos permitidos duplicados se rechazan al iniciar. No se ofrece ninguna herramienta MCP que cambie los permisos.

Esta restricción sirve para frenar lecturas accidentales o repetidas a través del MCP. El recuento se mantiene por proceso del servidor y se reinicia al reiniciar. No es un mecanismo para aislar a quien pueda reescribir la configuración o ejecutar otro proceso de la CLI o del MCP, así que combínela con el control de acceso de Proton.

Un valor leído con `read_field` se entrega a la IA. Este MCP no puede prohibir que el lado conectado guarde registros ni borrar una contraseña ya leída cuando caduca. Incluso al usar la entrega por archivo, confirme la URL del navegador del destino de entrada en el código de entrada de Codex.

### Desactivar la herramienta que devuelve texto plano

`PROTON_PASS_DISABLE_SECRET_READ=1` deja de registrar `read_field`, que devuelve texto plano a la conversación. Con `0` o sin definir, se registra como antes, y cualquier otro valor rechaza el inicio. `create_field_handoff` sigue disponible, por lo que con este ajuste aún funciona el inicio de sesión por archivo desde Codex. Para limitar los destinos y campos que se pueden leer, úselo junto con `PROTON_PASS_ACCESS_POLICY`. Este indicador por sí solo no prohíbe toda obtención de secretos.

## Instalación

Se requiere Node.js 22 o posterior. Tras instalar el servidor MCP, puede instalar la `pass-cli` oficial de Proton con el comando explícito `setup`.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` obtiene por HTTPS el manifiesto stable oficial de Proton y descarga la distribución oficial correspondiente al sistema operativo y la CPU actuales. Solo la extrae y la coloca si el SHA-256 del manifiesto coincide con el archivo real, y elimina los archivos temporales, salvo la copia de seguridad de la versión anterior que se indica cuando no es posible restaurar. No inicia sesión, no lee ni guarda un PAT y no cambia PATH.

Cuando se indica `PASS_CLI_PATH`, el inicio del MCP y `setup` sin `--force` usan solo ese ejecutable. Aunque el destino no sea válido, no recurren a la ubicación oficial predeterminada ni a `PATH`, y fallan por seguridad. Si se omite, busca una CLI existente en el directorio de instalación indicado (la ubicación oficial predeterminada si no se indica) y luego en `PATH`, y no descarga si encuentra una. Para reinstalar explícitamente la versión stable en la ubicación oficial predeterminada, use `--force`, que omite la búsqueda de una CLI existente. Para garantizar la instalación en una ubicación arbitraria, use `--force` junto con `--install-dir`.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

Las ubicaciones oficiales predeterminadas son las siguientes.

| SO | CPU compatible | Ubicación |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

Si el sistema operativo o la CPU no son compatibles, cambia el formato del manifiesto, la URL de descarga es peligrosa, se supera el límite de tamaño o el SHA-256 no coincide, termina sin sobrescribir la CLI existente. El manifiesto de distribución y el instalador oficiales de Proton están en [Proton Pass CLI](https://github.com/protonpass/pass-cli).

### Autenticar la CLI

`setup` y la autenticación están separados. Decida un directorio de sesión dedicado al MCP y ejecute `pass-cli login` una vez con la misma variable de entorno definida.

Ejemplo en Windows PowerShell:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

Ejemplo en macOS y Linux:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

Si usa una `pass-cli` existente o indicó `--install-dir`, defina en `PASS_CLI_PATH` la ruta absoluta de ese ejecutable. Para más detalles sobre la autenticación, consulte la [documentación de Pass CLI](https://protonpass.github.io/pass-cli/) oficial de Proton.

### Registrar en un cliente MCP

Registre la siguiente configuración stdio en su cliente MCP. Si se omite `PASS_CLI_PATH`, la CLI se detecta automáticamente desde la ubicación predeterminada o `PATH`, pero indíquela explícitamente si quiere fijar la CLI que se ejecuta. En Windows, si el cliente no puede resolver `npx`, siga las instrucciones de ese cliente e indique `npx.cmd` o la ruta absoluta del servidor instalado.

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

Con `@latest`, el cliente MCP usa la última versión de npm cada vez que inicia el servidor. Si ya lo registró con una versión fija como `@kagayoi/proton-pass-mcp@1.0.12`, reescriba el argumento de inicio registrado como `@kagayoi/proton-pass-mcp@latest` y a partir de entonces usará automáticamente la última versión (actualizar solo este README no cambia los registros existentes). Para fijar una versión concreta, regístrela con este formato de versión fija.

Si usa la detección automática, puede eliminar la línea `PASS_CLI_PATH`. Para una ubicación de CLI personalizada, cámbiela por la ruta absoluta de ese ejecutable. El PAT no se guarda en el archivo de configuración; se hace referencia a la sesión existente. Este servidor nunca guarda en los registros los cuerpos secretos ni los errores sin procesar de la CLI. El resultado de leer un campo se entrega al cliente conectado.

Si un mensaje indica que no hay una sesión válida, defina el mismo `PROTON_PASS_SESSION_DIR` que el MCP y compruébelo con `pass-cli info`. Este mensaje por sí solo no permite saber si la sesión caducó, fue revocada o si la ubicación de almacenamiento es distinta. Si la ubicación es correcta y se requiere autenticación, vuelva a autenticarse con `pass-cli login` en esa ubicación. Un cierre de sesión automático indicado explícitamente por la CLI se notifica con otro mensaje. El propio MCP nunca cierra sesión ni guarda tokens.

Si `setup` no encuentra una CLI existente y indicó `PASS_CLI_PATH`, compruebe que el valor apunte al ejecutable correcto. Si usa la detección automática, elimine esta variable y compruebe si el archivo existe en la ubicación oficial predeterminada y si `PATH` es visible desde el proceso actual. Si falla la extracción del ZIP de Windows, compruebe que Windows PowerShell esté disponible y el estado de la descarga oficial. Si falla la verificación del SHA-256, no la desactive; vuelva a ejecutarlo cuando el manifiesto de Proton y la distribución coincidan.

Si una actualización falla a mitad, los archivos existentes se restauran automáticamente. Si la restauración también falla, no elimine la copia de seguridad temporal que se muestra en el error; detenga la CLI y vuelva a ejecutarlo, o devuelva los archivos de la copia de seguridad al directorio de instalación.

En Windows, aunque `LOCALAPPDATA` no esté definida, se puede usar una CLI existente indicada en `PASS_CLI_PATH` o presente en `PATH`. Si en una instalación nueva no se puede determinar la ubicación predeterminada, defina `LOCALAPPDATA` o indique la ubicación con `setup --install-dir`.

## Licencia

Este servidor MCP se distribuye bajo la [MIT License](LICENSE). La Proton Pass CLI que se instala por separado con `setup` sigue la [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE) de Proton, y este paquete npm no incluye el binario de la CLI.

Para el desarrollo y la verificación, consulte [CONTRIBUTING.md](CONTRIBUTING.md); para la estructura del sistema, consulte [DESIGN.md](DESIGN.md).
