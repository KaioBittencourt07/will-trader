param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,
  [string]$DestinationRoot = ''
)

$ErrorActionPreference = 'Stop'

$source = [System.IO.Path]::GetFullPath($SourcePath)
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Source workspace not found: $source"
}
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  $DestinationRoot = Split-Path -Parent $source
}
$destination = [System.IO.Path]::GetFullPath($DestinationRoot)
if ($destination.Equals($source, [System.StringComparison]::OrdinalIgnoreCase) -or
    $destination.StartsWith($source.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Destination must be outside the source workspace.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $destination "will-trader-workspace-backup-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  & git -C $source status --short --branch 2>&1 | Out-File -LiteralPath (Join-Path $backup 'git-status.txt') -Encoding utf8
  & git -C $source rev-parse HEAD 2>&1 | Out-File -LiteralPath (Join-Path $backup 'git-head.txt') -Encoding utf8
  & git -C $source diff --binary HEAD 2>&1 | Out-File -LiteralPath (Join-Path $backup 'git-diff.patch') -Encoding utf8
  & git -C $source ls-files --others --exclude-standard 2>&1 | Out-File -LiteralPath (Join-Path $backup 'untracked-files.txt') -Encoding utf8
} else {
  'git executable not found; source file copy still proceeds.' | Out-File -LiteralPath (Join-Path $backup 'git-status.txt') -Encoding utf8
}

$excludeDirectories = @('.git', 'node_modules', '.next', '.cache', 'dist', 'coverage')
$excludeFiles = @('.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.crt', 'credentials.json', 'secrets.json')
$robocopyArgs = @($source, $backup, '/E', '/COPY:DAT', '/R:1', '/W:1', '/XD') + $excludeDirectories + @('/XF') + $excludeFiles + @('/NFL', '/NDL', '/NJH', '/NJS', '/NP')
& robocopy @robocopyArgs | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
  throw "Robocopy failed with exit code $robocopyExit. Source was not modified."
}

$sensitiveFiles = Get-ChildItem -LiteralPath $source -Recurse -File -Force | Where-Object {
  $_.Name -eq '.env' -or $_.Name -like '.env.*' -or $_.Name -like '*.pem' -or
  $_.Name -like '*.key' -or $_.Name -like '*.p12' -or $_.Name -like '*.pfx' -or
  $_.Name -like '*.crt' -or $_.Name -eq 'credentials.json' -or $_.Name -eq 'secrets.json'
} | ForEach-Object { $_.FullName.Substring($source.Length).TrimStart('\', '/') }
$sensitiveFiles | Out-File -LiteralPath (Join-Path $backup 'sensitive-files-excluded.txt') -Encoding utf8

@(
  "Source: $source"
  "Backup: $backup"
  "RobocopyExitCode: $robocopyExit"
  "Sensitive files were intentionally excluded from the copy; they remain in the source workspace."
  "No source files were deleted or modified."
) | Out-File -LiteralPath (Join-Path $backup 'BACKUP-REPORT.txt') -Encoding utf8

Write-Host "Backup completed: $backup" -ForegroundColor Green
Write-Host "Sensitive files excluded: $($sensitiveFiles.Count)" -ForegroundColor Yellow
Write-Host 'The original workspace was not changed.' -ForegroundColor Green
