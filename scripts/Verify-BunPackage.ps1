#requires -Version 7.4
[CmdletBinding()]
param([Parameter(Mandatory)][string] $PackageFile)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$archive = (Resolve-Path -LiteralPath $PackageFile).ProviderPath
$manifestJson = [IO.File]::ReadAllText((Join-Path $root 'package.json'))
$manifest = [System.Text.Json.Nodes.JsonNode]::Parse($manifestJson)
if ($manifest['name'].GetValue[string]() -cne '@kagayoi/proton-pass-mcp' -or
    $manifest['version'].GetValue[string]() -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?\z') { throw 'Package metadata differs' }
$expected = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
foreach ($file in @(
    'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE',
    # READMEの他言語版（Bunは README.*.md を自動で同梱する）。
    'README.de.md', 'README.es.md', 'README.fr.md', 'README.ja.md', 'README.ko.md', 'README.pt-BR.md', 'README.zh-CN.md', 'README.zh-TW.md',
    'src/access-policy.mjs', 'src/cli.mjs', 'src/handoff-consumer.mjs', 'src/handoff-janitor.mjs',
    'src/handoff-protocol.mjs', 'src/handoff-security.mjs', 'src/handoff-store.mjs',
    'src/i18n.mjs', 'src/inputs.mjs', 'src/pass.mjs', 'src/server.mjs', 'src/setup.mjs',
    # 人が読む文言の辞書（9言語）。
    'src/locales/de.json', 'src/locales/en.json', 'src/locales/es.json', 'src/locales/fr.json', 'src/locales/ja.json',
    'src/locales/ko.json', 'src/locales/pt-BR.json', 'src/locales/zh-CN.json', 'src/locales/zh-TW.json'
)) { $expected.Add('package/' + $file, (Join-Path $root $file)) }
if (-not [IO.File]::ReadAllText((Join-Path $root 'README.md')).Contains(
    $manifest['name'].GetValue[string]() + '@' + $manifest['version'].GetValue[string](), [StringComparison]::Ordinal)) {
    throw 'README package version differs'
}
# 他言語のREADMEも同じ固定版を含むことを確認し、公開前に版の取り残しを検出する。
foreach ($translated in Get-ChildItem -LiteralPath $root -File -Filter 'README.*.md') {
    if (-not [IO.File]::ReadAllText($translated.FullName).Contains(
        $manifest['name'].GetValue[string]() + '@' + $manifest['version'].GetValue[string](), [StringComparison]::Ordinal)) {
        throw "README package version differs: $($translated.Name)"
    }
}
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
# 検査とハッシュは同じ一度読み込んだアーカイブを使う。
$archiveBytes = [IO.File]::ReadAllBytes($archive)
$stream = [IO.MemoryStream]::new($archiveBytes, $false)
try {
    $gzip = [IO.Compression.GZipStream]::new($stream, [IO.Compression.CompressionMode]::Decompress)
    try {
        $reader = [System.Formats.Tar.TarReader]::new($gzip)
        try {
            while ($entry = $reader.GetNextEntry()) {
                if ($entry.EntryType -notin @([System.Formats.Tar.TarEntryType]::RegularFile, [System.Formats.Tar.TarEntryType]::V7RegularFile)) { throw "Unexpected archive entry type: $($entry.Name)" }
                if (-not $expected.ContainsKey($entry.Name) -or -not $seen.Add($entry.Name)) { throw "Unexpected or duplicate archive entry: $($entry.Name)" }
                $buffer = [IO.MemoryStream]::new()
                try { $entry.DataStream.CopyTo($buffer); $bytes = $buffer.ToArray() } finally { $buffer.Dispose() }
                if ($entry.Name -ceq 'package/package.json') {
                    $packed = [System.Text.Json.Nodes.JsonNode]::Parse([Text.Encoding]::UTF8.GetString($bytes))
                    if (-not [System.Text.Json.Nodes.JsonNode]::DeepEquals($packed, $manifest)) { throw 'Archive manifest differs from package.json' }
                } elseif (-not [Linq.Enumerable]::SequenceEqual[byte]($bytes, [IO.File]::ReadAllBytes($expected[$entry.Name]))) { throw "Archive contents differ: $($entry.Name)" }
                if ($entry.Name -ceq 'package/src/cli.mjs' -and (([int]$entry.Mode -band 73) -ne 73)) { throw 'Archive CLI is not executable' }
            }
        } finally { $reader.Dispose() }
    } finally { $gzip.Dispose() }
} finally { $stream.Dispose() }
if ($seen.Count -ne $expected.Count) { throw 'Archive is missing expected files' }
$integrity = 'sha512-' + [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData($archiveBytes))
[pscustomobject]@{ PackageFile = $archive; Integrity = $integrity; Files = $seen.Count }
