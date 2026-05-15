param(
  [string]$Otp = "",
  [switch]$SkipDirectPublish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Npm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$NpmArgs
  )

  & npm.cmd @NpmArgs
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($NpmArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function ConvertFrom-SecureStringPlainText {
  param([securestring]$Secure)

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Get-TokenFromJson {
  param([string]$Text)

  $start = $Text.IndexOf("{")
  $end = $Text.LastIndexOf("}")
  if ($start -lt 0 -or $end -lt $start) {
    throw "Could not find JSON in npm token output."
  }

  $json = $Text.Substring($start, $end - $start + 1)
  $payload = $json | ConvertFrom-Json

  foreach ($name in @("token", "key", "value")) {
    if ($payload.PSObject.Properties.Name -contains $name) {
      $candidate = $payload.$name
      if ($candidate) {
        return [string]$candidate
      }
    }
  }

  throw "Could not find token field in npm token output. Fields: $($payload.PSObject.Properties.Name -join ', ')"
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
if ($packageJson.name -ne "branchguard-cli") {
  throw "Refusing to publish unexpected package '$($packageJson.name)'."
}

Write-Host "BranchGuard beta publish helper" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host ""

Invoke-Npm "whoami" "--registry" "https://registry.npmjs.org/"
Invoke-Npm "run" "check"
Invoke-Npm "test"
Invoke-Npm "pack" "--dry-run" "--cache" ".npm-cache"

if (-not $SkipDirectPublish) {
  if (-not $Otp) {
    $Otp = Read-Host "Enter npm publish OTP, or press Enter to skip direct OTP publish"
  }

  if ($Otp) {
    Write-Host "Trying direct npm publish with OTP..." -ForegroundColor Cyan
    & npm.cmd publish --tag beta --otp $Otp --cache .npm-cache --registry https://registry.npmjs.org/
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
      exit 0
    }
    Write-Host "Direct OTP publish did not succeed. Falling back to temporary granular token flow." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Temporary granular token flow" -ForegroundColor Cyan
Write-Host "You will enter secrets locally in this PowerShell window. Do not paste them into chat."

$securePassword = Read-Host "npm password" -AsSecureString
$password = ConvertFrom-SecureStringPlainText $securePassword
$tokenOtp = Read-Host "npm 2FA OTP for token creation, or press Enter if npm does not ask for one"

$tokenArgs = @(
  "token", "create",
  "--name", "branchguard-cli-beta-publish",
  "--token-description", "Temporary BranchGuard beta publish token",
  "--expires", "1",
  "--packages-all",
  "--packages-and-scopes-permission", "read-write",
  "--bypass-2fa",
  "--password", $password,
  "--registry", "https://registry.npmjs.org/",
  "--json"
)

if ($tokenOtp) {
  $tokenArgs += @("--otp", $tokenOtp)
}

$tokenOutput = & npm.cmd @tokenArgs 2>&1
$tokenExit = $LASTEXITCODE
$password = $null

if ($tokenExit -ne 0) {
  $redactedOutput = ($tokenOutput -join "`n") -replace "npm_[A-Za-z0-9_\-]+", "npm_***redacted***"
  Write-Host $redactedOutput
  throw "npm token create failed with exit code $tokenExit"
}

$tokenText = $tokenOutput -join "`n"
$token = Get-TokenFromJson $tokenText

New-Item -ItemType Directory -Force ".tmp" | Out-Null
$tempNpmrc = Join-Path ".tmp" "publish.npmrc"

try {
  Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$token
"@

  Write-Host "Publishing with temporary token..." -ForegroundColor Cyan
  & npm.cmd publish --tag beta --cache .npm-cache --userconfig $tempNpmrc
  if ($LASTEXITCODE -ne 0) {
    throw "npm publish failed with exit code $LASTEXITCODE"
  }

  Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
}
