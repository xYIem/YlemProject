# ===========================================
# YLEM - DuckDNS Update Script
# ===========================================
# Updates your DuckDNS domain with your current public IP
# Run every 5 minutes via Task Scheduler
# ===========================================

param(
    [string]$Subdomain = $env:DUCKDNS_SUBDOMAIN,
    [string]$Token = $env:DUCKDNS_TOKEN,
    [string]$LogPath = "C:\ylem\logs\duckdns.log"
)

# Validate parameters
if ([string]::IsNullOrEmpty($Subdomain) -or [string]::IsNullOrEmpty($Token)) {
    Write-Host "Error: DUCKDNS_SUBDOMAIN and DUCKDNS_TOKEN must be set"
    exit 1
}

# Create log directory if needed
$logDir = Split-Path $LogPath -Parent
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Update DuckDNS
$url = "https://www.duckdns.org/update?domains=$Subdomain&token=$Token&ip="
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $result = $response.Content.Trim()
    
    if ($result -eq "OK") {
        $message = "[$timestamp] DuckDNS update successful"
    } else {
        $message = "[$timestamp] DuckDNS update failed: $result"
    }
} catch {
    $message = "[$timestamp] DuckDNS update error: $_"
}

# Log result
Add-Content -Path $LogPath -Value $message
Write-Host $message

# Keep log file from growing too large (keep last 1000 lines)
if (Test-Path $LogPath) {
    $lines = Get-Content $LogPath -Tail 1000
    Set-Content -Path $LogPath -Value $lines
}
