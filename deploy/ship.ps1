# One-command deploy: build, then ship to t' EVO (an' Vercel unless told otherwise).
#   .\deploy\ship.ps1            -> build + EVO + Vercel (both serving paths)
#   .\deploy\ship.ps1 -EvoOnly   -> build + EVO only (once Cloudflare carries www.moorstead.app)
param([switch]$EvoOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

npm run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

# EVO: LAN when home, Tailscale when out
$evo = $null
foreach ($h in 'evo', 'evo-tailscale') {
  ssh -o BatchMode=yes -o ConnectTimeout=4 $h 'true' 2>$null
  if ($LASTEXITCODE -eq 0) { $evo = $h; break }
}
if (-not $evo) { throw 'EVO unreachable on LAN or Tailscale' }
"shipping to EVO via $evo"
scp -r -o BatchMode=yes "$root/dist" "${evo}:moorstead/game.new"
ssh -o BatchMode=yes $evo 'cd ~/moorstead && rm -rf game.old && mv game game.old && mv game.new game && curl -s localhost:8090/ | grep -o "assets/index-[A-Za-z0-9_-]*\.js"'

if (-not $EvoOnly) {
  npx -y vercel@latest deploy --prod --yes
}
"shipped."
