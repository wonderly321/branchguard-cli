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

function Test-PackagePublished {
  param([string]$PackageName, [string]$Version)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & npm.cmd view "$PackageName@$Version" version --registry https://registry.npmjs.org/ --cache .npm-cache 1>$null 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return $exitCode -eq 0
}

function Get-MatchingTokenMetadata {
  param([string]$Token, [string]$UserConfig)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $output = & npm.cmd token list --json --registry https://registry.npmjs.org/ --userconfig $UserConfig 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0 -or -not $output) {
    return $null
  }

  try {
    $tokens = $output | ConvertFrom-Json
  } catch {
    return $null
  }

  foreach ($item in @($tokens)) {
    if (-not $item.token -or $item.token -notmatch "^(.*)\.\.\.(.*)$") {
      continue
    }

    $prefix = $Matches[1]
    $suffix = $Matches[2]
    if ($Token.StartsWith($prefix) -and $Token.EndsWith($suffix)) {
      return $item
    }
  }

  return $null
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
$packageName = $packageJson.name
$version = $packageJson.version

if ($packageName -ne "branchguard-cli") {
  throw "Refusing to publish unexpected package '$packageName'."
}

Write-Host "BranchGuard release publish helper" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host "Package: $packageName@$version"
Write-Host ""
Write-Host "Create an npm Granular Access Token in the browser with:" -ForegroundColor Yellow
Write-Host "- Package access: all packages"
Write-Host "- Permission: Read and write"
Write-Host "- Bypass 2FA: enabled"
Write-Host ""

Start-Process "https://www.npmjs.com/settings/sonori/tokens"

$secureToken = Read-Host "Paste npm granular token with Bypass 2FA" -AsSecureString
$token = ConvertFrom-SecureStringPlainText $secureToken
if (-not $token) {
  throw "No npm token provided."
}

Run-Npm @("run", "check")
Run-Npm @("test")
Run-Npm @("pack", "--dry-run", "--cache", ".npm-cache")

New-Item -ItemType Directory -Force ".tmp" | Out-Null
$tempNpmrc = Join-Path ".tmp" "release-publish.npmrc"
$smokeDir = Join-Path ".tmp" ("release-smoke-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

try {
  Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$token
"@

  $tokenMetadata = Get-MatchingTokenMetadata -Token $token -UserConfig $tempNpmrc
  if ($null -ne $tokenMetadata) {
    Write-Host "Token metadata:" -ForegroundColor Cyan
    Write-Host "- name: $($tokenMetadata.name)"
    Write-Host "- bypass_2fa: $($tokenMetadata.bypass_2fa)"
    Write-Host "- permissions: $($tokenMetadata.permissions | ConvertTo-Json -Compress)"
    Write-Host "- scopes: $($tokenMetadata.scopes | ConvertTo-Json -Compress)"

    if ($tokenMetadata.bypass_2fa -ne $true) {
      throw "This token has bypass_2fa=false. Create a new Granular Access Token with Bypass 2FA enabled, all packages, and read/write package permission."
    }
  } else {
    Write-Host "Could not read token metadata; continuing to publish attempt." -ForegroundColor Yellow
  }

  $token = $null

  if (Test-PackagePublished -PackageName $packageName -Version $version) {
    Write-Host "$packageName@$version already exists on npm; skipping publish." -ForegroundColor Yellow
  } else {
    Write-Host "$packageName@$version is not on npm yet; publishing now." -ForegroundColor Yellow
    Run-Npm @("publish", "--tag", "beta", "--access", "public", "--cache", ".npm-cache", "--userconfig", $tempNpmrc)
    Write-Host "Published $packageName@$version with beta tag." -ForegroundColor Green
  }

  Run-Npm @("install", "--prefix", $smokeDir, "$packageName@$version", "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache")

  $branchguardCmd = Join-Path $smokeDir "node_modules\.bin\branchguard.cmd"
  & $branchguardCmd --version
  if ($LASTEXITCODE -ne 0) {
    throw "smoke test failed with exit code $LASTEXITCODE"
  }

  Run-Npm @("dist-tag", "add", "$packageName@$version", "latest", "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache", "--userconfig", $tempNpmrc)
  Run-Npm @("dist-tag", "ls", $packageName, "--registry", "https://registry.npmjs.org/", "--cache", ".npm-cache")

  Write-Host "Published $packageName@$version and promoted latest successfully." -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
}
