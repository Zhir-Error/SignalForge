$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $workspaceRoot ".env"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Copy .env.example to .env and configure local PostgreSQL before migration verification."
}

$fileEnvironment = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*([^#\s][^=]*)=(.*)$') {
    $fileEnvironment[$matches[1]] = $matches[2]
  }
}

$baseMigrationUrl = if ($env:MIGRATION_DATABASE_URL) {
  $env:MIGRATION_DATABASE_URL
} else {
  $fileEnvironment["MIGRATION_DATABASE_URL"]
}
$baseRuntimeUrl = if ($env:DATABASE_URL) {
  $env:DATABASE_URL
} else {
  $fileEnvironment["DATABASE_URL"]
}
if (-not $baseMigrationUrl -or -not $baseRuntimeUrl) {
  throw "Both MIGRATION_DATABASE_URL and DATABASE_URL must be configured."
}

$migrationUri = [System.UriBuilder]::new($baseMigrationUrl)
$runtimeUri = [System.UriBuilder]::new($baseRuntimeUrl)
foreach ($uri in @($migrationUri, $runtimeUri)) {
  if ($uri.Scheme -notin @("postgres", "postgresql") -or
      $uri.Host -notin @("127.0.0.1", "localhost") -or
      $uri.Path.TrimStart('/') -ne "signalforge") {
    throw "Migration verification only accepts the local signalforge database connection."
  }
}

$databaseName = "signalforge_migration_check_$([Guid]::NewGuid().ToString('N'))"
$migrationUri.Path = "/$databaseName"
$runtimeUri.Path = "/$databaseName"
$createdDatabase = $false
$previousMigrationUrl = $env:MIGRATION_DATABASE_URL

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE."
  }
}

try {
  Invoke-CheckedCommand -FilePath "psql" -Arguments @(
    $baseMigrationUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--command", "CREATE DATABASE $databaseName"
  )
  $createdDatabase = $true

  $bootstrapSql = @"
GRANT CONNECT ON DATABASE $databaseName TO signalforge_app;
GRANT USAGE ON SCHEMA public TO signalforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO signalforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO signalforge_app;
"@
  Invoke-CheckedCommand -FilePath "psql" -Arguments @(
    $migrationUri.ToString(), "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--command", $bootstrapSql
  )

  $env:MIGRATION_DATABASE_URL = $migrationUri.ToString()
  Push-Location $workspaceRoot
  try {
    Invoke-CheckedCommand -FilePath "pnpm" -Arguments @("db:migrate")
  } finally {
    Pop-Location
  }

  $grantSql = @"
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO signalforge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO signalforge_app;
"@
  Invoke-CheckedCommand -FilePath "psql" -Arguments @(
    $migrationUri.ToString(), "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--command", $grantSql
  )
  Invoke-CheckedCommand -FilePath "psql" -Arguments @(
    $runtimeUri.ToString(), "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--command", 'SELECT current_user, COUNT(*) FROM public."user" GROUP BY current_user'
  )
  Write-Output "Fresh migrations and restricted-role schema access passed."
} finally {
  if ($previousMigrationUrl) {
    $env:MIGRATION_DATABASE_URL = $previousMigrationUrl
  } else {
    Remove-Item Env:MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
  }
  if ($createdDatabase) {
    Invoke-CheckedCommand -FilePath "psql" -Arguments @(
      $baseMigrationUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
      "--command", "DROP DATABASE $databaseName WITH (FORCE)"
    )
  }
}
