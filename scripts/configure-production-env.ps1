$ErrorActionPreference = 'Stop'

$target = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.production.local'
$existing = @{}
if (Test-Path -LiteralPath $target) {
  Get-Content -LiteralPath $target | ForEach-Object {
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $value = $matches[2].Trim()
      if ($value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2).Replace('\"', '"').Replace('\\', '\')
      }
      $existing[$matches[1]] = $value
    }
  }
}

function Read-ProductionValue([string]$Name, [string]$Default = '', [bool]$Secret = $false) {
  $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($processValue) { return $processValue.Trim() }
  if ($existing[$Name]) { return $existing[$Name] }
  if ($Default) { return $Default }
  if ($Secret) {
    $secure = Read-Host "Enter $Name" -AsSecureString
    return [System.Net.NetworkCredential]::new('', $secure).Password
  }
  return (Read-Host "Enter $Name").Trim()
}

function ConvertTo-DotEnvValue([string]$Value) {
  if ($Value.Contains("`r") -or $Value.Contains("`n")) { throw 'Environment values cannot contain newlines.' }
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

$values = [ordered]@{
  APP_ENV = 'production'
  APP_ORIGIN = 'https://learn.soliventa.tech'
  PORTAL_ORIGIN = 'https://portal.learn.soliventa.tech'
  PLATFORM_HOSTNAMES = 'api.learn.soliventa.tech,platform.learn.soliventa.tech'
  PLATFORM_BASE_DOMAIN = 'learn.soliventa.tech'
  PREVIEW_ORIGIN = 'https://preview.learn.soliventa.tech'
  SUPABASE_URL = 'https://asijnlpidhawmigfxinp.supabase.co'
  SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NENb2J63QRkTQ6xkdtRr2A_hdjxIzPy'
  VITE_SUPABASE_URL = 'https://asijnlpidhawmigfxinp.supabase.co'
  VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NENb2J63QRkTQ6xkdtRr2A_hdjxIzPy'
  TENANT_CACHE_KV_ID = 'e4051536b5ad4049b46991f2b3f0b890'
  RATE_LIMIT_NAMESPACE_ID = '1001'
  SITE_SESSION_KV_ID = '01626a58f1d741889be825ed312dad7f'
  CONFIRM_PRODUCTION_DEMO = 'ALL_FIVE_PRODUCTION'
  CONFIRM_MERIDIAN_FAMILY_DEMO = 'MERIDIAN_PRODUCTION'
  ALLOW_PAYSTACK_TEST_IN_PRODUCTION = 'true'
}

foreach ($name in @('SUPABASE_SECRET_KEY', 'PREVIEW_TOKEN_SECRET', 'PAYSTACK_SECRET_KEY', 'RESEND_API_KEY', 'CLOUDFLARE_API_TOKEN', 'PRODUCTION_DEMO_PASSWORD')) {
  $values[$name] = Read-ProductionValue $name '' $true
}
foreach ($name in @('RESEND_FROM_EMAIL', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_SAAS_TARGET', 'SITE_FORM_RATE_NAMESPACE_ID')) {
  $values[$name] = Read-ProductionValue $name
}

foreach ($name in @('OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_DATA_COLLECTION', 'LESSON_AI_DAILY_LIMIT', 'LESSON_AI_SCHOOL_DAILY_LIMIT')) {
  $configured = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($configured) { $values[$name] = $configured } elseif ($existing[$name]) { $values[$name] = $existing[$name] }
}

$lines = @('# Local production deployment configuration. Never commit this file.')
$lines += $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$(ConvertTo-DotEnvValue $_.Value)" }
[System.IO.File]::WriteAllLines($target, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Saved production configuration to $target"
Write-Host 'Values were not printed. Run: pnpm production:validate'
