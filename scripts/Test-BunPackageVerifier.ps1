#requires -Version 7.4
[CmdletBinding()]
param([Parameter(Mandatory)][string] $PackageFile, [Parameter(Mandatory)][string] $WorkDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PackageFile).ProviderPath)
$verifier = Join-Path $PSScriptRoot 'Verify-BunPackage.ps1'
$result = & $verifier -PackageFile $PackageFile
$expectedHash = 'sha512-' + [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData($source))
if ($result.Integrity -cne $expectedHash -or $result.Files -ne 15) { throw 'Valid archive verification failed' }

function New-Fixture([string] $Kind, [string] $Path) {
    $inputStream = [IO.MemoryStream]::new($source, $false)
    $inputGzip = [IO.Compression.GZipStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
    $reader = [System.Formats.Tar.TarReader]::new($inputGzip)
    $output = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    $outputGzip = [IO.Compression.GZipStream]::new($output, [IO.Compression.CompressionMode]::Compress)
    $writer = [System.Formats.Tar.TarWriter]::new($outputGzip)
    try {
        while ($entry = $reader.GetNextEntry()) {
            if ($Kind -ceq 'missing' -and $entry.Name -ceq 'package/src/access-policy.mjs') { continue }
            $data = [IO.MemoryStream]::new()
            try { $entry.DataStream.CopyTo($data); $bytes = $data.ToArray() } finally { $data.Dispose() }
            if ($Kind -ceq 'changed' -and $entry.Name -ceq 'package/src/access-policy.mjs') { $bytes = [Text.Encoding]::UTF8.GetBytes('changed') }
            if ($Kind -ceq 'manifest' -and $entry.Name -ceq 'package/package.json') {
                $manifest = [System.Text.Json.Nodes.JsonNode]::Parse([Text.Encoding]::UTF8.GetString($bytes))
                $manifest['description'] = 'changed'
                $bytes = [Text.Encoding]::UTF8.GetBytes($manifest.ToJsonString())
            }
            if ($Kind -ceq 'version' -and $entry.Name -cin @('package/package.json', 'package/README.md')) {
                $bytes = [IO.File]::ReadAllBytes((Join-Path $versionRoot $entry.Name.Substring('package/'.Length)))
            }
            if ($Kind -ceq 'type' -and $entry.Name -ceq 'package/src/access-policy.mjs') {
                $copy = [System.Formats.Tar.PaxTarEntry]::new([System.Formats.Tar.TarEntryType]::SymbolicLink, $entry.Name)
                $copy.LinkName = 'other'
                $writer.WriteEntry($copy)
                continue
            }
            $copy = [System.Formats.Tar.PaxTarEntry]::new([System.Formats.Tar.TarEntryType]::RegularFile, $entry.Name)
            $copy.Mode = if ($Kind -ceq 'mode' -and $entry.Name -ceq 'package/src/cli.mjs') { [IO.UnixFileMode]420 } else { $entry.Mode }
            $copy.DataStream = [IO.MemoryStream]::new($bytes, $false)
            try { $writer.WriteEntry($copy) } finally { $copy.DataStream.Dispose() }
            if ($Kind -ceq 'duplicate' -and $entry.Name -ceq 'package/src/access-policy.mjs') {
                $duplicate = [System.Formats.Tar.PaxTarEntry]::new([System.Formats.Tar.TarEntryType]::RegularFile, $entry.Name)
                $duplicate.DataStream = [IO.MemoryStream]::new($bytes, $false)
                try { $writer.WriteEntry($duplicate) } finally { $duplicate.DataStream.Dispose() }
            }
        }
        if ($Kind -ceq 'extra') {
            $extra = [System.Formats.Tar.PaxTarEntry]::new([System.Formats.Tar.TarEntryType]::RegularFile, 'package/unexpected.txt')
            $extra.DataStream = [IO.MemoryStream]::new([byte[]](1), $false)
            try { $writer.WriteEntry($extra) } finally { $extra.DataStream.Dispose() }
        }
    } finally {
        $writer.Dispose(); $outputGzip.Dispose(); $output.Dispose()
        $reader.Dispose(); $inputGzip.Dispose(); $inputStream.Dispose()
    }
}

$cases = [ordered]@{
    missing = 'missing expected files'
    extra = 'Unexpected or duplicate archive entry'
    duplicate = 'Unexpected or duplicate archive entry'
    changed = 'Archive contents differ'
    manifest = 'Archive manifest differs'
    type = 'Unexpected archive entry type'
    mode = 'Archive CLI is not executable'
}
foreach ($kind in $cases.Keys) {
    $fixture = Join-Path $WorkDirectory ($kind + '.tgz')
    New-Fixture $kind $fixture
    $message = $null
    try { $null = & $verifier -PackageFile $fixture } catch { $message = $_.Exception.Message }
    if (-not $message -or -not $message.Contains($cases[$kind], [StringComparison]::Ordinal)) { throw "Verifier did not reject $kind for the expected reason: $message" }
}

# 実リポジトリの版を変えず、コピーした正本と同じ版をアーカイブへ入れて確認する。
$versionRoot = Join-Path $WorkDirectory 'version-repo'
New-Item -ItemType Directory -Path $versionRoot, (Join-Path $versionRoot 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'src') -Destination $versionRoot -Recurse
foreach ($file in @('package.json', 'README.md', 'CHANGELOG.md', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) $file) -Destination $versionRoot
}
Copy-Item -LiteralPath $verifier -Destination (Join-Path $versionRoot 'scripts')
$manifestPath = Join-Path $versionRoot 'package.json'
$readmePath = Join-Path $versionRoot 'README.md'
$originalManifest = [IO.File]::ReadAllText($manifestPath)
$originalReadme = [IO.File]::ReadAllText($readmePath)
$original = [System.Text.Json.Nodes.JsonNode]::Parse($originalManifest)
$oldReference = $original['name'].GetValue[string]() + '@' + $original['version'].GetValue[string]()
$versions = @(
    @{ Value = '1.1.0-beta.1'; Accept = $true },
    @{ Value = '0.0.0-alpha-1'; Accept = $true },
    @{ Value = '01.1.0'; Accept = $false },
    @{ Value = '1.2.3/../../outside'; Accept = $false },
    @{ Value = "1.2.3`n"; Accept = $false },
    @{ Value = '1.2.3+metadata'; Accept = $false },
    @{ Value = '1.2.3-'; Accept = $false }
)
$index = 0
foreach ($case in $versions) {
    $manifest = [System.Text.Json.Nodes.JsonNode]::Parse($originalManifest)
    $manifest['version'] = $case.Value
    [IO.File]::WriteAllText($manifestPath, $manifest.ToJsonString())
    [IO.File]::WriteAllText($readmePath, $originalReadme.Replace($oldReference, $original['name'].GetValue[string]() + '@' + $case.Value))
    $fixture = Join-Path $WorkDirectory ("version-$index.tgz")
    New-Fixture 'version' $fixture
    $message = $null
    try { $null = & (Join-Path $versionRoot 'scripts/Verify-BunPackage.ps1') -PackageFile $fixture } catch { $message = $_.Exception.Message }
    if ($case.Accept -and $message) { throw "Verifier rejected allowed version: $message" }
    if (-not $case.Accept -and (-not $message -or -not $message.Contains('Package metadata differs', [StringComparison]::Ordinal))) {
        throw "Verifier accepted an invalid version or rejected it for another reason: $message"
    }
    $index++
}
Write-Output 'Bun package verifier: valid archive, 7 archive rejections, 2 prereleases and 5 invalid versions passed'
