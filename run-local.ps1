param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js não foi encontrado. Instale Node.js LTS e execute este arquivo novamente.'
}

if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
  throw 'Dependências ausentes. No diretório backend, execute npm install uma vez antes de iniciar.'
}

$env:PORT = $Port
Set-Location $backend
Write-Host "WILL TRADER iniciando em http://127.0.0.1:$Port/dashboard/"
node src/server.js
