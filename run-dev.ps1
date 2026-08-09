$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $scriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required. Install the LTS version from https://nodejs.org and try again." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "Kid Game is starting." -ForegroundColor Green
Write-Host "Open in your browser: http://localhost:8000"
$lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($lanAddress) {
  Write-Host "Same Wi-Fi: http://${lanAddress}:8000"
}
Write-Host "Press Ctrl+C to stop."

node "server/dev.mjs"
