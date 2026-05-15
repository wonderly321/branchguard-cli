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

function New-TokenArgs {
  param(
    [string]$Password,
    [string]$Otp,
    [string]$Scope,
    [string]$TokenName
  )

  $args = @(
    "token", "create",
    "--name", $TokenName,
    "--token-description", "Temporary BranchGuard beta publish token",
    "--expires", "1",
    "--scopes", $Scope,
    "--packages-and-scopes-permission", "read-write",
    "--bypass-2fa",
    "--password", $Password,
    "--registry", "https://registry.npmjs.org/",
    "--json"
  )

  if ($Otp) {
    $args += @("--otp", $Otp)
  }

  return $args
}

function Invoke-TokenCreate {
  param([string[]]$TokenArgs)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & npm.cmd @TokenArgs 2>&1
    return @{
      ExitCode = $LASTEXITCODE
      Output = $output
      Text = ($output -join "`n")
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
if ($packageJson.name -ne "@sonori/branchguard-cli") {
  throw "Refusing to publish unexpected package '$($packageJson.name)'."
}

$packageScope = ""
if ($packageJson.name -match "^@([^/]+)/") {
  $packageScope = "@$($Matches[1])"
} else {
  throw "Package must be scoped so the temporary granular token can be limited to a scope."
}

$tokenName = "branchguard-cli-beta-publish-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

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
    & npm.cmd publish --tag beta --access public --otp $Otp --cache .npm-cache --registry https://registry.npmjs.org/
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

$tokenResult = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $tokenResult = Invoke-TokenCreate (New-TokenArgs -Password $password -Otp $tokenOtp -Scope $packageScope -TokenName $tokenName)
  if ($tokenResult.ExitCode -eq 0) {
    break
  }

  $redactedOutput = $tokenResult.Text -replace "npm_[A-Za-z0-9_\-]+", "npm_***redacted***"
  Write-Host $redactedOutput

  if ($tokenResult.Text -match "Please check your email" -or $tokenResult.Text -match "one-time password") {
    $tokenOtp = Read-Host "Enter the npm OTP from your email/authenticator, then press Enter"
    continue
  }

  if ($attempt -lt 3) {
    $tokenOtp = Read-Host "Token creation failed. Enter a fresh npm OTP to retry, or press Enter to retry without OTP"
  }
}

$password = $null

if (-not $tokenResult -or $tokenResult.ExitCode -ne 0) {
  throw "npm token create failed with exit code $($tokenResult.ExitCode)"
}

$token = Get-TokenFromJson $tokenResult.Text

New-Item -ItemType Directory -Force ".tmp" | Out-Null
$tempNpmrc = Join-Path ".tmp" "publish.npmrc"

try {
  Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$token
"@

  Write-Host "Publishing with temporary token..." -ForegroundColor Cyan
  & npm.cmd publish --tag beta --access public --cache .npm-cache --userconfig $tempNpmrc
  if ($LASTEXITCODE -ne 0) {
    throw "npm publish failed with exit code $LASTEXITCODE"
  }

  Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
}
