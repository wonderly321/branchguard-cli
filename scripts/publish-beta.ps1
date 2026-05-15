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
    "--packages-and-scopes-permission", "read-write",
    "--bypass-2fa",
    "--password", $Password,
    "--registry", "https://registry.npmjs.org/",
    "--json"
  )

  if ($Scope) {
    $args += @("--scopes", $Scope)
  } else {
    $args += @("--packages-all")
  }

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

function Invoke-PublishWithToken {
  param(
    [string]$Token,
    [string]$Label
  )

  New-Item -ItemType Directory -Force ".tmp" | Out-Null
  $tempNpmrc = Join-Path ".tmp" "publish.npmrc"

  try {
    Set-Content -Encoding UTF8 -Path $tempNpmrc -Value @"
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$Token
"@

    Write-Host "Publishing with $Label..." -ForegroundColor Cyan

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = & npm.cmd publish --tag beta --access public --cache .npm-cache --userconfig $tempNpmrc 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    $text = $output -join "`n"
    if ($exitCode -ne 0) {
      $redactedOutput = $text -replace "npm_[A-Za-z0-9_\-]+", "npm_***redacted***"
      Write-Host $redactedOutput
      return @{
        Ok = $false
        ExitCode = $exitCode
        Text = $text
      }
    }

    Write-Host $text
    return @{
      Ok = $true
      ExitCode = 0
      Text = $text
    }
  } finally {
    Remove-Item -LiteralPath $tempNpmrc -Force -ErrorAction SilentlyContinue
  }
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
if ($packageJson.name -ne "branchguard-cli") {
  throw "Refusing to publish unexpected package '$($packageJson.name)'."
}

$packageScope = ""
if ($packageJson.name -match "^@([^/]+)/") {
  $packageScope = "@$($Matches[1])"
} else {
  Write-Host "Package is unscoped; CLI-created granular token may not work for first publish." -ForegroundColor Yellow
  Write-Host "If publish fails, use scripts/publish-beta-with-token.ps1 with a web-created token that has All packages + Bypass 2FA." -ForegroundColor Yellow
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
$publishResult = Invoke-PublishWithToken -Token $token -Label "temporary CLI-created token"
if ($publishResult.Ok) {
  Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
  exit 0
}

if (
  $publishResult.Text -match "E403" -or
  $publishResult.Text -match "E404" -or
  $publishResult.Text -match "Two-factor" -or
  $publishResult.Text -match "2fa" -or
  $publishResult.Text -match "security policy" -or
  $publishResult.Text -match "not found" -or
  $publishResult.Text -match "permission"
) {
  Write-Host ""
  Write-Host "The CLI-created token could not publish the first package under this scope." -ForegroundColor Yellow
  Write-Host "Opening npm token settings. Create a Granular Access Token with:" -ForegroundColor Yellow
  Write-Host "- Read and write package access"
  Write-Host "- Scope/package access for @sonori or all packages"
  Write-Host "- Bypass 2FA enabled"
  Write-Host "Then paste the token into this PowerShell window. Do not paste it into chat."
  Start-Process "https://www.npmjs.com/settings/sonori/tokens"

  $secureManualToken = Read-Host "Paste npm granular token with bypass 2FA" -AsSecureString
  $manualToken = ConvertFrom-SecureStringPlainText $secureManualToken
  if (-not $manualToken) {
    throw "No manual npm token provided."
  }

  $manualPublishResult = Invoke-PublishWithToken -Token $manualToken -Label "manual npm granular token"
  $manualToken = $null
  if ($manualPublishResult.Ok) {
    Write-Host "Published branchguard-cli beta successfully." -ForegroundColor Green
    exit 0
  }

  throw "Manual npm token publish failed. Make sure the token is Granular, Read and write, has access to @sonori or all packages, and has Bypass 2FA enabled."
}

throw "npm publish failed with exit code $($publishResult.ExitCode)"
