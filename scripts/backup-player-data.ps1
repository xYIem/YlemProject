# ===========================================
# YLEM - Player Data Backup Script
# ===========================================
# Run daily via Task Scheduler
# Backs up items.json and leaderboard.json
# ===========================================

param(
    [string]$YlemPath = "C:\ylem",
    [string]$BackupPath = "C:\ylem\backups",
    [int]$RetentionDays = 30
)

# Create backup directory if it doesn't exist
if (!(Test-Path $BackupPath)) {
    New-Item -ItemType Directory -Path $BackupPath -Force
}

# Get timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = Join-Path $BackupPath $timestamp

# Create timestamped backup folder
New-Item -ItemType Directory -Path $backupDir -Force

# Files to backup
$files = @(
    "game-server\items.json",
    "game-server\leaderboard.json"
)

# Copy files
foreach ($file in $files) {
    $source = Join-Path $YlemPath $file
    if (Test-Path $source) {
        $dest = Join-Path $backupDir (Split-Path $file -Leaf)
        Copy-Item $source $dest
        Write-Host "Backed up: $file"
    } else {
        Write-Host "Warning: $file not found"
    }
}

# Create a single zip file
$zipPath = Join-Path $BackupPath "ylem-backup-$timestamp.zip"
Compress-Archive -Path "$backupDir\*" -DestinationPath $zipPath -Force
Remove-Item -Path $backupDir -Recurse -Force
Write-Host "Created backup: $zipPath"

# Clean up old backups (keep last N days)
$cutoffDate = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupPath -Filter "ylem-backup-*.zip" | 
    Where-Object { $_.CreationTime -lt $cutoffDate } |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Host "Deleted old backup: $($_.Name)"
    }

Write-Host "Backup complete!"
