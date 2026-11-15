# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Português (Brasil)](README.pt-BR.md)

Ein lokaler MCP-Server, mit dem ein MCP-Client über eine vorhandene, mit `pass-cli` authentifizierte Sitzung in Proton Pass suchen kann. Er ist kein offizielles Proton-Produkt.

Wenn Sie Node.js nicht verwenden möchten, installieren Sie Bun 1.4.4 oder neuer und ändern Sie `"command": "npx"` und `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` unten jeweils in `"command": "bunx"` und `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]` (als Befehl: `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` ist nötig, damit die Ausführung mit Bun statt Node.js erfolgt. Bestehende `npx`-Konfigurationen funktionieren auch mit Node.js 22 oder neuer weiter.

## Funktionen

| Tool | Zweck |
|---|---|
| `session_status` | Die Sitzungsverbindung prüfen |
| `list_vaults` | Liste der Tresornamen und Freigabe-IDs |
| `list_shares` | Liste der erlaubten Freigaben |
| `list_items` | Nach Titel suchen und Einträge auflisten |
| `search_notes` | Teilstringsuche in Titel und Inhalt von Textnotizen (nicht verfügbar, solange eine Abrufbeschränkung gesetzt ist) |
| `create_field_handoff` | Einen Verweis auf eine geschützte temporäre Datei erstellen, ohne den Wert in die Unterhaltung zurückzugeben |
| `release_field_handoff` | Nicht verwendete oder fehlgeschlagene Übergaben zurückholen |
| `read_field` | Ein Feld mit angegebenem Grund abrufen. Einträge, Felder, Ablauf und Häufigkeit lassen sich beschränken |

`search_notes` gleicht Inhalte intern ab und liefert nur die passenden Titel, IDs und Status. Die Suche unterscheidet Groß- und Kleinschreibung. Anhänge werden nicht durchsucht. `state` ist standardmäßig `active`; geben Sie `all` an, um den Papierkorb einzuschließen.

Suchen Sie pro `share_id`, den Sie mit `list_vaults` erhalten. Bei `complete: false` fahren Sie mit denselben Kriterien fort, indem Sie `next_cursor` als `cursor` übergeben, und sammeln die `matches` aller Seiten. Ändert sich die Zielliste zwischendurch, suchen Sie von vorn. Inhalte werden mit ihrem Wert zum Zeitpunkt des Abgleichs verglichen.

Die Titelsuche von `list_items` unterscheidet nicht zwischen Groß- und Kleinschreibung. Ist `next_offset` vorhanden, fahren Sie fort, indem Sie ihn als `offset` angeben.

`search_notes`, `read_field` und `create_field_handoff` erfordern einen `reason` (5 bis 300 Zeichen nach Entfernen umgebender Leerzeichen, in Unicode-Codepoints gezählt), der die konkrete Anfrage oder den Zweck nennt. `read_field` übergibt den angeforderten Wert als Klartext-Tool-Ergebnis an die KI. Er kann im Unterhaltungsverlauf und in den Arbeitsprotokollen des verbundenen Dienstes verbleiben, und die Angabe eines Grundes ist kein Mechanismus für interaktive Freigabe oder zur Unterdrückung von Protokollen. Um in Codex einen Wert einzugeben, ohne ihn in der Unterhaltung anzuzeigen, verwenden Sie die Dateiübergabe unten.

Das `field` von `read_field` kann ein Name mit Leerzeichen, Nicht-ASCII-Zeichen oder einem Abschnittsnamen sein (zum Beispiel `Production.Password`). Es muss 1 bis 100 Zeichen (in Unicode-Codepoints) lang sein und darf keine Steuerzeichen enthalten.

### Aus Codex anmelden, ohne das Passwort in der Unterhaltung anzuzeigen

Das funktioniert, wenn der MCP und die Browser-Ausführungsumgebung von Codex auf dieselben lokalen Dateien zugreifen können. Der MCP gibt nur `handoff_id`, `file_path`, `expires_at`, `consumer_module_url` und den Feldnamen zurück. Das Passwort selbst gibt er nie zurück.

1. Bestätigen Sie die Anmelde-URL und das Zielkonto.
2. Übergeben Sie Freigabe-ID, Eintrags-ID, Feldnamen und Grund an `create_field_handoff`.
3. Übergeben Sie im Browser-Ausführungscode von Codex den zurückgegebenen Verweis an `withFieldHandoff`, um den Wert einzugeben. Geben Sie den Wert nicht an Tools aus, die den Inhalt lesen, an `console.log`, `nodeRepl.write` usw.
4. Wenn Sie ohne Verwendung abbrechen, übergeben Sie die `handoff_id` an `release_field_handoff`. Löst die Eingabe eine Ausnahme aus, löscht die Hilfsfunktion die Datei nach der Verwendung. Eine erneute Ausführung für eine bereits zurückgeholte oder unbekannte ID ist unbedenklich, eine ID, die dieser Server nicht bestätigen kann, liefert aber `{ released: false }`.

Hier ein JavaScript-Beispiel, das den in Codex integrierten Browser steuert. `receipt` ist der vom Erstellungs-Tool zurückgegebene Verweis, `tab` ein bestätigter Browser-Tab. Passen Sie URL und Beschriftung an das tatsächliche Anmeldeziel an.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('Das Anmeldeziel hat sich geändert.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

Die Hilfsfunktion lässt den Abruf der Datei nur einmal zu und löscht sie nach der Verwendung, unabhängig davon, ob der Callback erfolgreich ist oder fehlschlägt. Sie gibt auch weder den Rückgabewert des Callbacks noch unbearbeitete Ausnahmen nach außen. Der normale Rückgabewert ist `{ consumed: true }`.

Die Dateiübergabe ist ab 1.0.10 verfügbar. Starten Sie die veröffentlichte Version mit der folgenden Konfiguration. `PROTON_PASS_DISABLE_SECRET_READ=1` deaktiviert nur `read_field`, das Klartext in die Unterhaltung zurückgibt; die Dateiübergabe bleibt verfügbar. Eine vorhandene `PROTON_PASS_ACCESS_POLICY` kann zusätzlich verwendet werden.

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

| Einstellung für temporäre Dateien | Verhalten |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | Ablaufzeit. 1 bis 300 Sekunden, Standard 60. Läuft die Zugriffsrichtlinie früher ab, hat sie Vorrang |
| `PROTON_PASS_HANDOFF_DIR` | Optionales Speicherverzeichnis. Muss ein normalisierter lokaler absoluter Pfad mit vorhandenem übergeordnetem Verzeichnis sein. UNC-Pfade und das Stammverzeichnis selbst sind nicht zulässig. Ohne Angabe wird ein benutzerspezifischer temporärer Bereich verwendet |

Vor dem Speichern eines Werts prüft der Server unter Windows eine ACL, die nur den aktuellen Benutzer zulässt, und unter POSIX Verzeichnis- und Dateiberechtigungen nur für den Besitzer. Er lehnt ab, wenn ein vorhandener Bereich unsichere Berechtigungen hat oder ein Link erkannt wird. Berechtigungen werden nie automatisch gelockert oder repariert.

Nicht verwendete Dateien werden bei Ablauf und beim Beenden des MCP-Servers zurückgeholt. Wird der Server abrupt beendet, holt ein Überwachungsprozess sie zurück. Konnte keines von beiden laufen (zum Beispiel weil das Betriebssystem angehalten wurde), holt der nächste Start die abgelaufenen zurück, ebenso diejenigen, deren besitzender Server nachweislich gestoppt ist, auch vor Ablauf. Ein fehlgeschlagenes Löschen gilt nicht als Erfolg, und die Bereinigung bei Ablauf wird fortgesetzt. Schlägt beim Start die Prüfung oder Rückholung des vorhandenen Bereichs fehl, wird der Start abgelehnt; prüfen Sie dann Speicherort und Zugriffsrechte.

Dieses Verfahren verringert die Wege, auf denen ein Wert in die Unterhaltung gelangt, doch Klartext existiert in lokalen Dateien, im Ausführungsspeicher und im Browser. Es garantiert weder Isolation vom selben Betriebssystembenutzer oder von Administratoren noch das unwiederbringliche Löschen von Speicher oder Datenträger, noch dass nichts in internen Protokollen der Ausführungsumgebung gespeichert wird. Clients, die nicht direkt aus einer Datei eingeben können, wie Grok Bot, können dieses Verfahren nicht für die automatische Eingabe nutzen.

### Anmelden und dabei den abrufbaren Bereich beschränken

Auf der Proton-Seite wird empfohlen, zunächst einen eigenen PAT für den Agenten mit **nur den nötigen Einträgen, viewer (nur lesen) und kurzer Gültigkeit** anzulegen und eine mit diesem PAT authentifizierte dedizierte Sitzung zu verwenden. Wird ein ganzer Tresor erlaubt, sind alle Einträge darin zugänglich. Zum Erstellen des PAT, seiner Gültigkeit und seinen Berechtigungen siehe die [offizielle Proton-Zugriffskontrolle](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control). Dieser MCP ändert die Berechtigungen eines PAT oder einer vorhandenen Sitzung nie automatisch.

Auf der MCP-Seite können Sie in `PROTON_PASS_ACCESS_POLICY` außerdem JSON wie das folgende angeben. `username`, `password` und `totp` des angegebenen Kontos bleiben abrufbar, und nicht erlaubte Einträge oder Felder werden vor dem Aufruf der CLI abgelehnt.

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

Ersetzen Sie `SHARE_ID` und `ITEM_ID` durch Werte, die Sie über `list_vaults` / `list_shares` / `list_items` bestätigt haben. `fields` sind die exakten Feldnamen des gespeicherten Eintrags. Starten Sie den MCP-Server nach Änderung der Einstellungen neu.

Die Zugriffsbeschränkung ist ab 1.0.10 verfügbar. Starten Sie die veröffentlichte Version mit der folgenden Konfiguration. Ersetzen Sie Pfade und IDs durch Ihren eigenen Speicherort und die Einträge, die Sie erlauben.

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

| Einstellung | Verhalten |
|---|---|
| `allowed_items` | Erforderlich. Erlaubt per exakter Übereinstimmung von Freigabe-ID, Eintrags-ID und Feldname. Ein leeres Array bedeutet keine erlaubten Einträge und eine leere Liste |
| `max_reads_per_minute` | Obergrenze der Abrufversuche in den letzten 60 Sekunden. 1 bis 1000, Standard 10. CLI-Versuche für erlaubte Felder werden auch bei Fehlschlag gezählt |
| `expires_at` | Optional. Der Ablauf als ISO 8601 mit Zeitzone, zum Beispiel `2027-01-01T00:00:00Z`. Ersetzen Sie ihn im Betrieb durch den benötigten Ablauf |

Solange sie gesetzt ist, werden auch Listen und Titelsuchen auf die erlaubten Einträge und Freigaben eingeschränkt. Damit kein Weg bleibt, aus dem Abgleich von Notizinhalten nicht erlaubte Inhalte abzuleiten, wird `search_notes` abgelehnt. Der Ablauf wird zu Beginn der Verarbeitung, nach der Authentifizierungsprüfung und vor der Rückgabe des Ergebnisses geprüft, und es wird auch bei Ablauf mittendrin kein Wert zurückgegeben. `session_status` kann den Verbindungsstatus auch nach dem Ablauf melden.

Ohne die Umgebungsvariable bleibt das Verhalten unverändert. Die Einstellungs-JSON muss UTF-8 und höchstens 64 KiB groß sein, mit höchstens 1000 erlaubten Einträgen und 1 bis 32 nicht doppelten Feldern je Eintrag. Leere Zeichenfolgen, ungültiges JSON, unbekannte Einstellungen und doppelte erlaubte Einträge werden beim Start abgelehnt. Es gibt kein MCP-Tool, das die Berechtigungen ändert.

Diese Beschränkung soll versehentliche oder wiederholte Abrufe über den MCP eindämmen. Der Zähler wird pro Serverprozess geführt und beim Neustart zurückgesetzt. Sie ist kein Mechanismus, um jemanden zu isolieren, der die Einstellungen umschreiben oder einen anderen CLI- oder MCP-Prozess ausführen kann; kombinieren Sie sie daher mit der Zugriffskontrolle von Proton.

Ein mit `read_field` abgerufener Wert wird an die KI übergeben. Dieser MCP kann der verbundenen Seite das Speichern von Protokollen nicht verbieten und ein bereits abgerufenes Passwort bei Ablauf nicht löschen. Auch bei Verwendung der Dateiübergabe sollten Sie die Browser-URL des Eingabeziels im Eingabecode von Codex bestätigen.

### Das Tool deaktivieren, das Klartext zurückgibt

`PROTON_PASS_DISABLE_SECRET_READ=1` registriert `read_field` nicht, das Klartext in die Unterhaltung zurückgibt. Bei `0` oder ohne Angabe wird es wie bisher registriert, und jeder andere Wert lehnt den Start ab. `create_field_handoff` bleibt verfügbar, sodass die dateibasierte Anmeldung aus Codex mit dieser Einstellung weiterhin funktioniert. Um die abrufbaren Ziele und Felder einzuschränken, verwenden Sie es zusammen mit `PROTON_PASS_ACCESS_POLICY`. Dieses Flag allein verbietet nicht jeden Abruf von Geheimnissen.

## Installation

Node.js 22 oder neuer ist erforderlich. Nach der Installation des MCP-Servers können Sie die offizielle Proton-`pass-cli` mit dem expliziten Befehl `setup` installieren.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` lädt Protons offizielles stable-Manifest per HTTPS und das offizielle Build für das aktuelle Betriebssystem und die aktuelle CPU herunter. Es entpackt und platziert es nur, wenn der SHA-256 im Manifest mit der tatsächlichen Datei übereinstimmt, und löscht temporäre Dateien, außer der Sicherung der Vorversion, auf die bei unmöglicher Wiederherstellung hingewiesen wird. Es meldet sich nicht an, liest oder speichert keinen PAT und ändert PATH nicht.

Ist `PASS_CLI_PATH` angegeben, verwenden der MCP-Start und `setup` ohne `--force` nur diese ausführbare Datei. Selbst wenn das Ziel ungültig ist, weichen sie nicht auf den offiziellen Standardort oder `PATH` aus und schlagen aus Sicherheitsgründen fehl. Ohne Angabe wird im angegebenen Installationsverzeichnis (ohne Angabe am offiziellen Standardort) und dann in `PATH` nach einer vorhandenen CLI gesucht; wird eine gefunden, wird nichts heruntergeladen. Um die stable-Version ausdrücklich am offiziellen Standardort neu zu installieren, verwenden Sie `--force`, das die Suche nach einer vorhandenen CLI überspringt. Um die Installation an einem beliebigen Ort zu garantieren, verwenden Sie `--force` zusammen mit `--install-dir`.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

Die offiziellen Standardorte sind die folgenden.

| OS | Unterstützte CPU | Ort |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

Bei nicht unterstütztem Betriebssystem oder nicht unterstützter CPU, geändertem Manifestformat, gefährlicher Download-URL, überschrittener Größenbegrenzung oder SHA-256-Abweichung endet es, ohne die vorhandene CLI zu überschreiben. Protons offizielles Verteilungsmanifest und der Installer sind unter [Proton Pass CLI](https://github.com/protonpass/pass-cli) verfügbar.

### Die CLI authentifizieren

`setup` und Authentifizierung sind getrennt. Legen Sie ein eigenes Sitzungsverzeichnis für den MCP fest und führen Sie `pass-cli login` einmal mit gesetzter gleicher Umgebungsvariable aus.

Beispiel für Windows PowerShell:

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

Beispiel für macOS und Linux:

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

Wenn Sie eine vorhandene `pass-cli` verwenden oder `--install-dir` angegeben haben, setzen Sie den absoluten Pfad dieser ausführbaren Datei in `PASS_CLI_PATH`. Einzelheiten zur Authentifizierung finden Sie in Protons offizieller [Pass-CLI-Dokumentation](https://protonpass.github.io/pass-cli/).

### In einem MCP-Client registrieren

Registrieren Sie die folgende stdio-Konfiguration in Ihrem MCP-Client. Wird `PASS_CLI_PATH` weggelassen, wird die CLI automatisch am Standardort oder in `PATH` erkannt, geben Sie sie aber ausdrücklich an, wenn Sie die auszuführende CLI festlegen möchten. Kann der Client unter Windows `npx` nicht auflösen, folgen Sie den Anweisungen dieses Clients und geben Sie `npx.cmd` oder den absoluten Pfad des installierten Servers an.

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

Mit `@latest` verwendet der MCP-Client bei jedem Start des Servers die neueste npm-Version. Wenn Sie bereits eine feste Version wie `@kagayoi/proton-pass-mcp@1.0.12` registriert haben, schreiben Sie das registrierte Startargument in `@kagayoi/proton-pass-mcp@latest` um, dann wird danach automatisch die neueste Version verwendet (die Aktualisierung dieser README allein ändert bestehende Registrierungen nicht). Um eine bestimmte Version festzulegen, registrieren Sie sie in dieser Form mit fester Version.

Bei Verwendung der automatischen Erkennung können Sie die Zeile `PASS_CLI_PATH` löschen. Ändern Sie sie bei einem eigenen CLI-Ort auf den absoluten Pfad dieser ausführbaren Datei. Der PAT wird nicht in der Einstellungsdatei gespeichert; die vorhandene Sitzung wird referenziert. Dieser Server speichert nie geheime Inhalte oder unbearbeitete CLI-Fehler in Protokollen. Das Ergebnis eines Feldabrufs wird an den verbundenen Client übergeben.

Meldet eine Nachricht, dass keine gültige Sitzung vorhanden ist, setzen Sie dasselbe `PROTON_PASS_SESSION_DIR` wie beim MCP und prüfen Sie mit `pass-cli info`. Diese Meldung allein lässt nicht erkennen, ob die Sitzung abgelaufen ist, widerrufen wurde oder der Speicherort abweicht. Ist der Ort richtig und eine Authentifizierung erforderlich, authentifizieren Sie sich für diesen Ort mit `pass-cli login` erneut. Eine von der CLI ausdrücklich gemeldete automatische Abmeldung wird mit einer anderen Meldung angezeigt. Der MCP selbst meldet sich nie ab und speichert keine Token.

Findet `setup` keine vorhandene CLI und haben Sie `PASS_CLI_PATH` angegeben, prüfen Sie, ob der Wert auf die richtige ausführbare Datei zeigt. Bei automatischer Erkennung löschen Sie diese Variable und prüfen, ob die Datei am offiziellen Standardort vorhanden ist und ob `PATH` vom aktuellen Prozess aus sichtbar ist. Schlägt das Entpacken des Windows-ZIP fehl, prüfen Sie, ob Windows PowerShell verfügbar ist, und den Zustand des offiziellen Downloads. Schlägt die SHA-256-Prüfung fehl, deaktivieren Sie sie nicht; führen Sie den Vorgang erneut aus, sobald Protons Manifest und die Distribution übereinstimmen.

Schlägt ein Update zwischendurch fehl, werden die vorhandenen Dateien automatisch wiederhergestellt. Schlägt auch die Wiederherstellung fehl, löschen Sie die im Fehler angezeigte temporäre Sicherung nicht; beenden Sie die CLI und führen Sie den Vorgang erneut aus, oder legen Sie die Dateien aus der Sicherung wieder im Installationsverzeichnis ab.

Unter Windows kann auch bei nicht gesetztem `LOCALAPPDATA` eine vorhandene CLI aus `PASS_CLI_PATH` oder in `PATH` verwendet werden. Lässt sich bei einer Neuinstallation der Standardort nicht bestimmen, setzen Sie `LOCALAPPDATA` oder geben Sie den Ort mit `setup --install-dir` an.

## Lizenz

Dieser MCP-Server steht unter der [MIT License](LICENSE). Die separat mit `setup` installierte Proton Pass CLI folgt Protons [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE), und dieses npm-Paket enthält die CLI-Binärdatei nicht.

Zu Entwicklung und Verifikation siehe [CONTRIBUTING.md](CONTRIBUTING.md), zur Struktur des Systems siehe [DESIGN.md](DESIGN.md).
