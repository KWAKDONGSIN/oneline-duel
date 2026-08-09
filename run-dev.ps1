$ErrorActionPreference = "Stop"
$env:MOCK = "1"
$judge = Start-Process -FilePath "node" -ArgumentList "server/server.mjs" -WindowStyle Hidden -PassThru

try {
  Write-Host "한줄승부: http://localhost:8000"
  $lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($lanAddress) {
    Write-Host "같은 와이파이 접속: http://${lanAddress}:8000"
  }
  python -m http.server 8000
}
finally {
  Stop-Process -Id $judge.Id -Force -ErrorAction SilentlyContinue
}
