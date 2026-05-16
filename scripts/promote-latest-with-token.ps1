Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringPlainText {
  param([securestring]$Secure)

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Run-Npm {
  param([string[]]$Arguments)

  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
$packageName = $packageJson.name
$version = $packageJson.version

if ($packageName -ne "branchguard-cli") {
  throw "Refusing to promote unexpected package '$packageName'."
}

Write-Host "BranchGuard latest tag helper" -ForegroundColor Cyan
Write-Host "Package: $packageName@$version"
Write-Host ""

$secureToken = Read-Host "Paste npm granular token with Bypass 2FA" -AsSecureString
$token = ConvertFrom-SecureStringPlainText $secureToken
if (-not $token) {
  throw "No npm token provided."
}

New-Item -ItemType Directory -Force ".tmp" | Out-Null
$tempNpmrc = Join-Path ".tmp" "promote-latest.npmrc"

try {
  Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$token
"@
  $token = $null

  Run-Npm @("view", "$packageName@$version", "version", "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache", "--prefer-online")
  Run-Npm @("dist-tag", "add", "$packageName@$version", "latest", "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache", "--userconfig", $tempNpmrc)
  Run-Npm @("dist-tag", "ls", $packageName, "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache")

  Write-Host "Promoted $packageName@$version to latest." -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
}
