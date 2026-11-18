# Proton Pass MCP

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Serveur MCP local qui permet à un client MCP de rechercher dans Proton Pass via une session authentifiée existante de `pass-cli`. Ce n'est pas un produit officiel de Proton.

Pour ne pas utiliser Node.js, installez Bun 1.4.4 ou version ultérieure et remplacez `"command": "npx"` et `"args": ["--yes", "@kagayoi/proton-pass-mcp@latest"]` ci-dessous respectivement par `"command": "bunx"` et `"args": ["--bun", "@kagayoi/proton-pass-mcp@latest"]` (sous forme de commande : `bunx --bun @kagayoi/proton-pass-mcp@latest`). `--bun` est nécessaire pour exécuter avec Bun au lieu de Node.js. Les configurations `npx` existantes continuent aussi de fonctionner avec Node.js 22 ou version ultérieure.

## Fonctionnalités

| Outil | Usage |
|---|---|
| `session_status` | Vérifier la connexion de la session |
| `list_vaults` | Liste des noms de coffres et des ID de partage |
| `list_shares` | Liste des partages autorisés |
| `list_items` | Rechercher par titre et lister les éléments |
| `search_notes` | Recherche de sous-chaîne dans le titre et le corps des notes texte (indisponible tant qu'une restriction de lecture est configurée) |
| `create_field_handoff` | Créer une référence vers un fichier temporaire protégé sans renvoyer la valeur dans la conversation |
| `release_field_handoff` | Récupérer les transferts inutilisés ou en échec |
| `read_field` | Lire un champ en indiquant un motif. Éléments, champs, expiration et fréquence peuvent être restreints |

`search_notes` compare les corps en interne et ne renvoie que les titres, ID et états correspondants. La recherche est sensible à la casse. Les pièces jointes ne sont pas recherchées. La valeur par défaut de `state` est `active` ; indiquez `all` pour inclure la corbeille.

Recherchez pour chaque `share_id` obtenu avec `list_vaults`. Si `complete: false`, poursuivez avec les mêmes critères en passant `next_cursor` comme `cursor`, et rassemblez les `matches` de toutes les pages. Si la liste cible change en cours de route, recommencez la recherche depuis le début. Les corps sont comparés avec leur valeur au moment de la comparaison.

La recherche par titre de `list_items` n'est pas sensible à la casse. Si `next_offset` est présent, poursuivez en le passant comme `offset`.

`search_notes`, `read_field` et `create_field_handoff` exigent un `reason` (de 5 à 300 caractères après suppression des espaces aux extrémités, comptés en points de code Unicode) indiquant la demande ou la finalité concrète. `read_field` transmet la valeur demandée à l'IA sous forme de résultat d'outil en texte brut. Elle peut subsister dans l'historique de conversation et les journaux de travail du service connecté, et indiquer un motif n'est pas un mécanisme d'approbation interactive ni de suppression des journaux. Pour saisir une valeur dans Codex sans l'afficher dans la conversation, utilisez le transfert par fichier ci-dessous.

Le `field` de `read_field` peut être un nom contenant des espaces, des caractères non ASCII ou un nom de section (par exemple `Production.Password`). Il doit comporter de 1 à 100 caractères (en points de code Unicode) et ne doit pas contenir de caractères de contrôle.

### Se connecter depuis Codex sans afficher le mot de passe dans la conversation

Cela fonctionne lorsque le MCP et l'environnement d'exécution du navigateur de Codex peuvent accéder aux mêmes fichiers locaux. Le MCP ne renvoie que `handoff_id`, `file_path`, `expires_at`, `consumer_module_url` et le nom du champ. Il ne renvoie jamais le mot de passe lui-même.

1. Confirmez l'URL de connexion et le compte cible.
2. Passez l'ID de partage, l'ID de l'élément, le nom du champ et le motif à `create_field_handoff`.
3. Dans le code d'exécution du navigateur de Codex, passez la référence renvoyée à `withFieldHandoff` pour saisir la valeur. N'envoyez pas la valeur à des outils qui lisent le corps, à `console.log`, à `nodeRepl.write`, etc.
4. Si vous abandonnez sans l'utiliser, passez le `handoff_id` à `release_field_handoff`. Si la saisie lève une exception, la fonction auxiliaire supprime le fichier après usage. Relancer avec un ID déjà récupéré ou inconnu est sans danger, mais un ID que ce serveur ne peut pas confirmer renvoie `{ released: false }`.

Voici un exemple en JavaScript qui pilote le navigateur intégré de Codex. `receipt` est la référence renvoyée par l'outil de création et `tab` est un onglet de navigateur confirmé. Adaptez l'URL et le libellé à la cible de connexion réelle.

```javascript
var { withFieldHandoff } = await import(receipt.consumer_module_url);
await withFieldHandoff(receipt, async value => {
  if (new URL(await tab.url()).origin !== 'https://example.com') {
    throw new Error('La cible de connexion a changé.');
  }
  await tab.playwright.getByLabel('Password', { exact: true }).fill(value);
});
```

La fonction auxiliaire ne permet de récupérer le fichier qu'une seule fois et le supprime après usage, que le callback réussisse ou échoue. Elle ne renvoie pas non plus la valeur de retour du callback ni les exceptions brutes. La valeur de retour normale est `{ consumed: true }`.

Le transfert par fichier est disponible depuis la version 1.0.10. Démarrez la version publiée avec la configuration ci-dessous. `PROTON_PASS_DISABLE_SECRET_READ=1` désactive uniquement `read_field`, qui renvoie du texte brut dans la conversation ; le transfert par fichier reste disponible. Un `PROTON_PASS_ACCESS_POLICY` existant peut être utilisé en même temps.

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

| Paramètre des fichiers temporaires | Comportement |
|---|---|
| `PROTON_PASS_HANDOFF_TTL_SECONDS` | Durée de validité. De 1 à 300 secondes, 60 par défaut. Si la politique d'accès expire plus tôt, c'est elle qui prévaut |
| `PROTON_PASS_HANDOFF_DIR` | Répertoire de stockage facultatif. Doit être un chemin absolu local normalisé dont le parent existe. Les chemins UNC et le répertoire racine lui-même ne sont pas autorisés. S'il n'est pas défini, une zone temporaire propre à l'utilisateur est utilisée |

Avant de stocker une valeur, le serveur vérifie une ACL n'autorisant que l'utilisateur actuel sous Windows, et des permissions de répertoire et de fichier réservées au propriétaire sous POSIX. Il refuse si une zone existante a des permissions peu sûres ou si un lien est détecté. Il n'assouplit ni ne répare jamais les permissions automatiquement.

Les fichiers inutilisés sont récupérés à l'expiration et à la sortie du serveur MCP. Si le serveur se termine brutalement, un processus de surveillance les récupère. Si ni l'un ni l'autre n'a pu s'exécuter (par exemple parce que le système s'est arrêté), le prochain démarrage récupère ceux qui ont expiré, ainsi que ceux dont le serveur propriétaire est confirmé arrêté, même avant l'expiration. Une suppression qui échoue n'est pas considérée comme réussie et la récupération à l'expiration continue. Si la validation ou la récupération de la zone existante échoue au démarrage, le démarrage est refusé : vérifiez l'emplacement de stockage et les droits d'accès.

Cette approche réduit les chemins par lesquels une valeur atteint la conversation, mais du texte brut existe dans les fichiers locaux, la mémoire d'exécution et le navigateur. Elle ne garantit ni l'isolation vis-à-vis du même utilisateur du système ou des administrateurs, ni l'effacement irrécupérable de la mémoire ou du disque, ni l'absence de stockage dans les journaux internes de l'environnement d'exécution. Les clients qui ne peuvent pas saisir directement depuis un fichier, comme Grok Bot, ne peuvent pas utiliser cette approche pour la saisie automatique.

### Se connecter en restreignant ce qui peut être lu

Côté Proton, il est recommandé de créer d'abord un PAT réservé à l'agent avec **uniquement les éléments nécessaires, viewer (lecture seule) et une courte durée de validité**, et d'utiliser une session dédiée authentifiée avec ce PAT. Autoriser un coffre entier rend tous ses éléments accessibles. Pour la création du PAT, sa durée de validité et ses permissions, consultez le [contrôle d'accès officiel de Proton](https://protonpass.github.io/pass-cli/get-started/configuration/#access-control). Ce MCP ne modifie jamais automatiquement les permissions d'un PAT ou d'une session existante.

Côté MCP, vous pouvez aussi définir dans `PROTON_PASS_ACCESS_POLICY` un JSON comme celui-ci. `username`, `password` et `totp` du compte indiqué restent lisibles, et les éléments ou champs non autorisés sont refusés avant l'appel à la CLI.

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

Remplacez `SHARE_ID` et `ITEM_ID` par les valeurs confirmées avec `list_vaults` / `list_shares` / `list_items`. `fields` sont les noms exacts des champs utilisés par l'élément enregistré. Redémarrez le serveur MCP après avoir modifié les paramètres.

La restriction d'accès est disponible depuis la version 1.0.10. Démarrez la version publiée avec la configuration ci-dessous. Remplacez les chemins et les ID par votre propre emplacement et les éléments que vous autorisez.

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

| Paramètre | Comportement |
|---|---|
| `allowed_items` | Obligatoire. Autorisation par correspondance exacte de l'ID de partage, de l'ID d'élément et du nom de champ. Un tableau vide signifie aucun élément autorisé et une liste vide |
| `max_reads_per_minute` | Limite de tentatives de lecture sur les 60 dernières secondes. De 1 à 1000, 10 par défaut. Les tentatives de la CLI sur des champs autorisés sont comptées même en cas d'échec |
| `expires_at` | Facultatif. L'expiration au format ISO 8601 avec fuseau horaire, par exemple `2027-01-01T00:00:00Z`. Remplacez-la par l'expiration nécessaire en exploitation |

Lorsqu'elle est définie, les listes et les recherches par titre sont aussi restreintes aux éléments et partages autorisés. Pour ne laisser aucun chemin permettant de déduire un contenu non autorisé à partir des correspondances dans le corps des notes, `search_notes` est refusé. L'expiration est vérifiée au début du traitement, après la vérification d'authentification et avant le renvoi du résultat, et aucune valeur n'est renvoyée même si elle expire en cours de route. `session_status` peut toujours indiquer l'état de la connexion après l'expiration.

Sans la variable d'environnement, le comportement est inchangé. Le JSON de configuration doit être en UTF-8 et faire au plus 64 KiB, avec au plus 1000 éléments autorisés et de 1 à 32 champs distincts par élément. Les chaînes vides, le JSON invalide, les paramètres inconnus et les éléments autorisés en double sont refusés au démarrage. Aucun outil MCP modifiant les autorisations n'est fourni.

Cette restriction vise à limiter les lectures accidentelles ou répétées via le MCP. Le compteur est conservé par processus serveur et se réinitialise au redémarrage. Ce n'est pas un mécanisme pour isoler quelqu'un qui peut réécrire les paramètres ou exécuter un autre processus CLI ou MCP ; combinez-la avec le contrôle d'accès de Proton.

Une valeur lue avec `read_field` est transmise à l'IA. Ce MCP ne peut pas interdire au côté connecté de conserver des journaux ni effacer un mot de passe déjà lu à son expiration. Même avec le transfert par fichier, confirmez l'URL du navigateur de la cible de saisie dans le code de saisie de Codex.

### Désactiver l'outil qui renvoie du texte brut

`PROTON_PASS_DISABLE_SECRET_READ=1` cesse d'enregistrer `read_field`, qui renvoie du texte brut dans la conversation. Avec `0` ou non défini, il est enregistré comme avant, et toute autre valeur refuse le démarrage. `create_field_handoff` reste disponible, la connexion par fichier depuis Codex fonctionne donc toujours avec ce paramètre. Pour restreindre les cibles et champs lisibles, utilisez-le avec `PROTON_PASS_ACCESS_POLICY`. Ce seul indicateur n'interdit pas toute récupération de secret.

## Installation

Node.js 22 ou version ultérieure est requis. Après avoir installé le serveur MCP, vous pouvez installer la `pass-cli` officielle de Proton avec la commande explicite `setup`.

```powershell
npm install -g @kagayoi/proton-pass-mcp
proton-pass-mcp setup
```

`setup` récupère en HTTPS le manifeste stable officiel de Proton et télécharge la distribution officielle correspondant au système et au processeur actuels. Il ne l'extrait et ne la place que si le SHA-256 du manifeste correspond au fichier réel, et supprime les fichiers temporaires, sauf la sauvegarde de la version précédente indiquée lorsque la restauration est impossible. Il ne se connecte pas, ne lit ni ne stocke de PAT et ne modifie pas PATH.

Lorsque `PASS_CLI_PATH` est défini, le démarrage du MCP et `setup` sans `--force` n'utilisent que cet exécutable. Même si la cible est invalide, ils ne se rabattent pas sur l'emplacement officiel par défaut ni sur `PATH`, et échouent par sécurité. S'il est omis, une CLI existante est recherchée dans le répertoire d'installation indiqué (l'emplacement officiel par défaut s'il n'est pas indiqué), puis dans `PATH`, et rien n'est téléchargé si une CLI est trouvée. Pour réinstaller explicitement la version stable à l'emplacement officiel par défaut, utilisez `--force`, qui ignore la recherche d'une CLI existante. Pour garantir l'installation à un emplacement arbitraire, utilisez `--force` avec `--install-dir`.

```powershell
proton-pass-mcp setup --force
proton-pass-mcp setup --force --install-dir 'D:\Tools\ProtonPass'
proton-pass-mcp setup --help
```

Les emplacements officiels par défaut sont les suivants.

| OS | Processeur pris en charge | Emplacement |
|---|---|---|
| Windows | x64 | `%LOCALAPPDATA%\Programs\ProtonPass\pass-cli.exe` |
| macOS | Apple Silicon / x64 | `~/.local/bin/pass-cli` |
| Linux | arm64 / x64 | `~/.local/bin/pass-cli` |

Pour un système ou un processeur non pris en charge, un format de manifeste modifié, une URL de téléchargement dangereuse, une taille dépassant la limite ou un SHA-256 qui ne correspond pas, il se termine sans écraser la CLI existante. Le manifeste de distribution et l'installateur officiels de Proton sont disponibles sur [Proton Pass CLI](https://github.com/protonpass/pass-cli).

### Authentifier la CLI

`setup` et l'authentification sont séparés. Choisissez un répertoire de session dédié au MCP et exécutez `pass-cli login` une fois, avec la même variable d'environnement définie.

Exemple Windows PowerShell :

```powershell
$env:PROTON_PASS_SESSION_DIR = "$env:LOCALAPPDATA\Kagayoi\ProtonPassMcp\session"
New-Item -ItemType Directory -Force $env:PROTON_PASS_SESSION_DIR | Out-Null
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" login
& "$env:LOCALAPPDATA\Programs\ProtonPass\pass-cli.exe" info
```

Exemple macOS et Linux :

```bash
export PROTON_PASS_SESSION_DIR="$HOME/.local/share/proton-pass-mcp/session"
mkdir -p "$PROTON_PASS_SESSION_DIR"
"$HOME/.local/bin/pass-cli" login
"$HOME/.local/bin/pass-cli" info
```

Si vous utilisez une `pass-cli` existante ou avez indiqué `--install-dir`, définissez dans `PASS_CLI_PATH` le chemin absolu de cet exécutable. Pour plus de détails sur l'authentification, consultez la [documentation de Pass CLI](https://protonpass.github.io/pass-cli/) officielle de Proton.

### Enregistrer auprès d'un client MCP

Enregistrez la configuration stdio suivante dans votre client MCP. Si `PASS_CLI_PATH` est omis, la CLI est détectée automatiquement depuis l'emplacement par défaut ou `PATH`, mais indiquez-le explicitement si vous voulez figer la CLI exécutée. Sous Windows, si le client ne peut pas résoudre `npx`, suivez les instructions de ce client et indiquez `npx.cmd` ou le chemin absolu du serveur installé.

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

Avec `@latest`, le client MCP utilise la dernière version de npm à chaque démarrage du serveur. Si vous l'avez déjà enregistré avec une version figée telle que `@kagayoi/proton-pass-mcp@1.0.14`, réécrivez l'argument de démarrage enregistré en `@kagayoi/proton-pass-mcp@latest` et la dernière version sera ensuite utilisée automatiquement (la seule mise à jour de ce README ne modifie pas les enregistrements existants). Pour figer une version précise, enregistrez-la sous cette forme de version figée.

Si vous utilisez la détection automatique, vous pouvez supprimer la ligne `PASS_CLI_PATH`. Pour un emplacement de CLI personnalisé, remplacez-la par le chemin absolu de cet exécutable. Le PAT n'est pas stocké dans le fichier de configuration ; la session existante est utilisée. Ce serveur n'enregistre jamais dans les journaux les corps secrets ni les erreurs brutes de la CLI. Le résultat de la lecture d'un champ est transmis au client connecté.

Si un message indique qu'il n'y a pas de session valide, définissez le même `PROTON_PASS_SESSION_DIR` que le MCP et vérifiez avec `pass-cli info`. Ce message seul ne permet pas de savoir si la session a expiré, a été révoquée ou si l'emplacement de stockage diffère. Si l'emplacement est correct et qu'une authentification est requise, authentifiez-vous de nouveau avec `pass-cli login` pour cet emplacement. Une déconnexion automatique explicitement signalée par la CLI est annoncée par un autre message. Le MCP lui-même ne se déconnecte jamais et ne stocke jamais de jetons.

Si `setup` ne trouve pas de CLI existante et que vous avez indiqué `PASS_CLI_PATH`, vérifiez que la valeur désigne le bon exécutable. Si vous utilisez la détection automatique, supprimez cette variable et vérifiez si le fichier existe à l'emplacement officiel par défaut et si `PATH` est visible depuis le processus actuel. Si l'extraction du ZIP Windows échoue, vérifiez que Windows PowerShell est disponible et l'état du téléchargement officiel. Si la vérification SHA-256 échoue, ne la désactivez pas ; relancez une fois que le manifeste de Proton et la distribution correspondent.

Si une mise à jour échoue en cours de route, les fichiers existants sont restaurés automatiquement. Si la restauration échoue aussi, ne supprimez pas la sauvegarde temporaire indiquée dans l'erreur ; arrêtez la CLI puis relancez, ou remettez les fichiers de la sauvegarde dans le répertoire d'installation.

Sous Windows, même si `LOCALAPPDATA` n'est pas défini, une CLI existante indiquée par `PASS_CLI_PATH` ou présente dans `PATH` peut être utilisée. Si l'emplacement par défaut ne peut pas être déterminé pour une nouvelle installation, définissez `LOCALAPPDATA` ou indiquez l'emplacement avec `setup --install-dir`.

## Licence

Ce serveur MCP est sous [MIT License](LICENSE). La Proton Pass CLI installée séparément par `setup` suit la [GPL-3.0 License](https://github.com/protonpass/pass-cli/blob/main/LICENSE) de Proton, et ce paquet npm n'inclut pas le binaire de la CLI.

Pour le développement et la vérification, consultez [CONTRIBUTING.md](CONTRIBUTING.md) ; pour la structure du système, consultez [DESIGN.md](DESIGN.md).
