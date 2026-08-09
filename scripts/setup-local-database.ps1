$ErrorActionPreference = "Stop"
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentPath = Join-Path $workspacePath ".env.local"
$examplePath = Join-Path $workspacePath ".env.example"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is not installed. Install Docker Desktop, start it, then run npm run db:setup again."
}

if (-not (Test-Path -LiteralPath $environmentPath)) {
  $bytes = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $sessionSecret = [Convert]::ToBase64String($bytes)
  $environment = Get-Content -Raw -LiteralPath $examplePath
  $environment = $environment.Replace('SESSION_SECRET="replace-with-a-long-random-secret"', "SESSION_SECRET=`"$sessionSecret`"")
  Set-Content -LiteralPath $environmentPath -Value $environment -Encoding UTF8 -NoNewline
  Write-Host "Created .env.local with a generated session secret."
} else {
  Write-Host ".env.local already exists and was left unchanged."
}

$databaseLine = Get-Content -LiteralPath $environmentPath | Where-Object { $_ -match '^DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $databaseLine) { throw ".env.local does not contain DATABASE_URL." }
$databaseValue = ($databaseLine -replace '^DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if (-not $databaseValue) {
  $databaseValue = "postgresql://chainward:chainward@localhost:5432/chainward?schema=public"
  $environment = Get-Content -Raw -LiteralPath $environmentPath
  $environment = $environment -replace '(?m)^DATABASE_URL\s*=.*$', "DATABASE_URL=`"$databaseValue`""
  Set-Content -LiteralPath $environmentPath -Value $environment -Encoding UTF8 -NoNewline
  Write-Host "Configured .env.local to use the local PostgreSQL service."
}
if (-not $databaseValue.StartsWith("postgresql://")) { throw "DATABASE_URL must be a PostgreSQL connection string." }
$env:DATABASE_URL = $databaseValue

Push-Location $workspacePath
try {
  & docker compose up -d postgres
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL could not be started." }
  & npm run db:generate
  if ($LASTEXITCODE -ne 0) { throw "Prisma client generation failed." }
  & npm run db:push
  if ($LASTEXITCODE -ne 0) { throw "The Chainward database schema could not be created." }
} finally {
  Pop-Location
}

Write-Host "Local Chainward database is ready. Restart npm run dev if it was already running."
