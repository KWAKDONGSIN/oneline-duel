$ErrorActionPreference = "Stop"
$env:MOCK = "1"
$judge = Start-Process -FilePath "node" -ArgumentList "server/server.mjs" -WindowStyle Hidden -PassThru

try {
  Write-Host "한줄승부: http://localhost:8000"
  python -m http.server 8000
}
finally {
  Stop-Process -Id $judge.Id -Force -ErrorAction SilentlyContinue
}
