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

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
if ($packageJson.name -ne "branchguard-cli") {
  throw "Refusing to publish unexpected package '$($packageJson.name)'."
}

Write-Host "BranchGuard token publish helper" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host ""
Write-Host "Create an npm Granular Access Token in the browser with:" -ForegroundColor Yellow
Write-Host "- Package access: @sonori scope or all packages"
Write-Host "- Permission: Read and write"
Write-Host "- Bypass 2FA: enabled"
Write-Host ""

Start-Process "https://www.npmjs.com/settings/sonori/tokens"

$secureToken = Read-Host "Paste npm granular token with Bypass 2FA" -AsSecureString
$token = ConvertFrom-SecureStringPlainText $secureToken
if (-not $token) {
  throw "No npm token provided."
}

& npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "npm run check failed" }

& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "npm test failed" }

New-Item -ItemType Directory -Force ".tmp" | Out-Null
$tempNpmrc = Join-Path ".tmp" "publish.npmrc"

try {
  Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$token
"@
  $token = $null

  & npm.cmd publish --tag beta --access public --cache .npm-cache --userconfig $tempNpmrc
  if ($LASTEXITCODE -ne 0) {
    throw "npm publish failed with exit code $LASTEXITCODE"
  }

  Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
}
