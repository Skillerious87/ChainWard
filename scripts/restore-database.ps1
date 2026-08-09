param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$backupDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\backups"))
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
$allowedPrefix = $backupDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedBackup.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Restore files must be inside the Chainward backups directory."
}
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump" -or -not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) {
  throw "Choose an existing .dump file created by the Chainward backup command."
}

if (-not $Force) {
  $confirmation = Read-Host "This replaces the current local Chainward database. Type RESTORE to continue"
  if ($confirmation -ne "RESTORE") { throw "Restore cancelled." }
}

$containerPath = "/tmp/chainward-restore.dump"
& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL could not be started." }
& docker compose cp $resolvedBackup "postgres:$containerPath"
if ($LASTEXITCODE -ne 0) { throw "The backup could not be copied into PostgreSQL." }
& docker compose exec -T postgres pg_restore -U chainward -d chainward --clean --if-exists --no-owner --no-privileges --exit-on-error $containerPath
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed. The current database may require manual review." }
& docker compose exec -T postgres rm -f $containerPath

Write-Host "Full database restore completed from: $resolvedBackup"
