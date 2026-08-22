[CmdletBinding()]
param(
  [string]$SourceDirectory,
  [string]$DestinationDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
  $SourceDirectory = Join-Path $PSScriptRoot 'out'
}
if ([string]::IsNullOrWhiteSpace($DestinationDirectory)) {
  $DestinationDirectory = Join-Path $projectRoot 'public\vendor\ruckig'
}

$sourcePath = (Resolve-Path -LiteralPath $SourceDirectory -ErrorAction Stop).Path
$destinationPath = [System.IO.Path]::GetFullPath($DestinationDirectory)
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $destinationPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stage Ruckig outside the frontend project: '$destinationPath'."
}

$requiredFiles = @(
  'hcr_ruckig_local.mjs',
  'hcr_ruckig_local.wasm',
  'hcr_ruckig_local.manifest.json',
  'RUCKIG_LICENSE.txt'
)
foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $file) -PathType Leaf)) {
    throw "Ruckig audit output is missing '$file'. Run npm run ruckig:wasm:build first."
  }
}

$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'hcr_ruckig_local.manifest.json') -Raw | ConvertFrom-Json
if (
  $manifest.abiVersion -ne 'ruckig-local-5d-v2' -or
  $manifest.ruckigVersion -ne '0.19.4' -or
  $manifest.ruckigCommit -ne 'a8db97a4e9c55e5160a3855f739fa3b270df8e4c' -or
  $manifest.license -ne 'MIT' -or
  $manifest.cloudClientCompiled -ne $false
) {
  throw 'Ruckig audit manifest does not match the pinned local-only Worker contract.'
}

$modulePath = Join-Path $sourcePath 'hcr_ruckig_local.mjs'
$wasmPath = Join-Path $sourcePath 'hcr_ruckig_local.wasm'
if ((Get-Item -LiteralPath $modulePath).Length -ne [int64]$manifest.moduleBytes -or (Get-Item -LiteralPath $wasmPath).Length -ne [int64]$manifest.wasmBytes) {
  throw 'Ruckig audit manifest byte counts do not match the files being staged.'
}
$wasmHash = (Get-FileHash -LiteralPath $wasmPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($wasmHash -ne $manifest.wasmSha256) {
  throw 'Ruckig audit manifest SHA-256 does not match the WASM file being staged.'
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
foreach ($file in $requiredFiles) {
  Copy-Item -LiteralPath (Join-Path $sourcePath $file) -Destination (Join-Path $destinationPath $file) -Force
}

Write-Host "Staged audited local Ruckig Worker assets at $destinationPath"
