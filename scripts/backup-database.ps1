param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backupDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $backupDirectory.StartsWith($workspacePath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup output must remain inside the Chainward workspace."
}

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupDirectory "chainward-full-$stamp.dump"
$containerPath = "/tmp/chainward-full-$stamp.dump"

& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL could not be started." }
& docker compose exec -T postgres pg_dump -U chainward -d chainward -Fc --no-owner --no-privileges -f $containerPath
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }
& docker compose cp "postgres:$containerPath" $backupPath
if ($LASTEXITCODE -ne 0) { throw "The backup could not be copied to the device." }
& docker compose exec -T postgres rm -f $containerPath

Write-Host "Full database backup created: $backupPath"
