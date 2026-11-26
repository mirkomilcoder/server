# Windows: copy panel/dist to the server for development (no root needed).
#   .\scripts\deploy.ps1 [-Target home-server@localhost] [-Port 2222]
param([string]$Target = "home-server@localhost", [int]$Port = 2222)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path "dist/manifest.json")) { throw "dist/ yo'q — avval: npm run build" }
ssh -p $Port $Target "rm -rf ~/.local/share/cockpit/mirkomil.new && mkdir -p ~/.local/share/cockpit/mirkomil.new"
scp -P $Port -r "dist/*" "${Target}:.local/share/cockpit/mirkomil.new/"
ssh -p $Port $Target "rm -rf ~/.local/share/cockpit/mirkomil && mv ~/.local/share/cockpit/mirkomil.new ~/.local/share/cockpit/mirkomil && echo deployed"
