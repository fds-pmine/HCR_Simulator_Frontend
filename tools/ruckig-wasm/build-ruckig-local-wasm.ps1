[CmdletBinding()]
param(
  [string]$EmsdkRoot = $env:HCR_EMSDK_ROOT,
  [string]$OutputDirectory,
  [string]$CacheDirectory,
  [switch]$SkipBrowserProbe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RuckigVersion = '0.19.4'
$RuckigCommit = 'a8db97a4e9c55e5160a3855f739fa3b270df8e4c'
$EmscriptenVersion = '4.0.20'
$MaximumBundleBytes = 256KB

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot 'out'
}
if ([string]::IsNullOrWhiteSpace($CacheDirectory)) {
  $CacheDirectory = Join-Path $env:TEMP 'hcr-ruckig-wasm-cache'
}

if ([string]::IsNullOrWhiteSpace($EmsdkRoot)) {
  throw 'Set HCR_EMSDK_ROOT or pass -EmsdkRoot to a locally installed Emscripten SDK.'
}

$emsdkEnvironment = Join-Path $EmsdkRoot 'emsdk_env.bat'
if (-not (Test-Path -LiteralPath $emsdkEnvironment -PathType Leaf)) {
  throw "Could not find emsdk_env.bat under '$EmsdkRoot'."
}
$versionOutput = & cmd.exe /d /s /c ('call "' + $emsdkEnvironment + '" >nul 2>nul && em++ --version')
$expectedVersionPattern = '\b' + [regex]::Escape($EmscriptenVersion) + '\b'
if ($LASTEXITCODE -ne 0 -or (($versionOutput -join "`n") -notmatch $expectedVersionPattern)) {
  throw "The supplied Emscripten SDK is not the required $EmscriptenVersion release."
}

$git = Get-Command git -ErrorAction Stop
$sourceDirectory = Join-Path $CacheDirectory "ruckig-$RuckigCommit"
if (-not (Test-Path -LiteralPath $sourceDirectory)) {
  New-Item -ItemType Directory -Path $CacheDirectory -Force | Out-Null
  & $git.Source clone --depth 1 --branch "v$RuckigVersion" https://github.com/pantor/ruckig.git $sourceDirectory
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not retrieve the pinned Ruckig source.'
  }
}

$actualCommit = (& $git.Source -C $sourceDirectory rev-parse HEAD).Trim()
if ($actualCommit -ne $RuckigCommit) {
  throw "Pinned Ruckig source mismatch: expected $RuckigCommit, found $actualCommit."
}

$wrapper = Join-Path $PSScriptRoot 'ruckig_local.cpp'
$includeDirectory = Join-Path $sourceDirectory 'include'
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf) -or -not (Test-Path -LiteralPath $includeDirectory -PathType Container)) {
  throw 'The local wrapper or pinned Ruckig headers are missing.'
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$moduleOutput = Join-Path $OutputDirectory 'hcr_ruckig_local.mjs'
$wasmOutput = Join-Path $OutputDirectory 'hcr_ruckig_local.wasm'
$sources = @($wrapper) + @(
  Get-ChildItem (Join-Path $sourceDirectory 'src\ruckig') -Filter '*.cpp' |
    Where-Object { $_.Name -ne 'cloud_client.cpp' } |
    Sort-Object Name |
    ForEach-Object FullName
)
if ($sources.Count -lt 2) {
  throw 'The pinned Ruckig local solver sources are incomplete.'
}

$quotedSources = $sources | ForEach-Object { '"' + $_ + '"' }
$compilerArguments = @(
  '-std=c++20',
  '-O3',
  ('-I"' + $includeDirectory + '"')
) + @($quotedSources) + @(
  ('-o "' + $moduleOutput + '"'),
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sENVIRONMENT=worker',
  '-sFILESYSTEM=0',
  '-sALLOW_MEMORY_GROWTH=0',
  '-sINITIAL_MEMORY=16777216',
  "-sEXPORTED_FUNCTIONS=['_ruckig_sample_5d','_malloc','_free']",
  "-sEXPORTED_RUNTIME_METHODS=['HEAPF64']"
)
$commandLine = 'call "' + $emsdkEnvironment + '" >nul 2>nul && em++ ' + ($compilerArguments -join ' ')
& cmd.exe /d /s /c $commandLine
if ($LASTEXITCODE -ne 0) {
  throw 'The local Ruckig WASM compilation failed.'
}

foreach ($output in @($moduleOutput, $wasmOutput)) {
  if (-not (Test-Path -LiteralPath $output -PathType Leaf)) {
    throw "Ruckig compilation did not emit '$output'."
  }
}

$bundleBytes = (Get-Item -LiteralPath $moduleOutput).Length + (Get-Item -LiteralPath $wasmOutput).Length
if ($bundleBytes -gt $MaximumBundleBytes) {
  throw "Ruckig WASM bundle is $bundleBytes bytes, above the $MaximumBundleBytes byte gate."
}

$manifest = [ordered]@{
  ruckigVersion = $RuckigVersion
  ruckigCommit = $RuckigCommit
  license = 'MIT'
  emscriptenVersion = $EmscriptenVersion
  cloudClientCompiled = $false
  licenseFile = 'RUCKIG_LICENSE.txt'
  moduleBytes = (Get-Item -LiteralPath $moduleOutput).Length
  wasmBytes = (Get-Item -LiteralPath $wasmOutput).Length
  wasmSha256 = (Get-FileHash -LiteralPath $wasmOutput -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json
$licensePath = Join-Path $OutputDirectory 'RUCKIG_LICENSE.txt'
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'LICENSE') -Destination $licensePath -Force
$manifestPath = Join-Path $OutputDirectory 'hcr_ruckig_local.manifest.json'
[System.IO.File]::WriteAllText($manifestPath, "$manifest`n", [System.Text.UTF8Encoding]::new($false))

if (-not $SkipBrowserProbe) {
  & node (Join-Path $PSScriptRoot 'verify-ruckig-local-wasm.mjs') $OutputDirectory
  if ($LASTEXITCODE -ne 0) {
    throw 'The local Ruckig Worker/browser probe failed.'
  }
}

Write-Host "Ruckig WASM audit passed: $manifestPath"
