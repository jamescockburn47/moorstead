# Moorstead Parish Ledger — standalone dashboard window for James's PC.
# Idempotent: if t' ledger window's already open, does nowt. Otherwise probes
# t' EVO on LAN first (fast at home), Tailscale if away, an' opens an Edge
# app-mode window in its own profile (own taskbar entry, no browser chrome).
# Run by: Startup shortcut, desktop shortcut, an' t' watchdog scheduled task
# ("Moorstead Parish Ledger Watchdog", every 2 min) — t' guard keeps it to one.
$PROFILE_DIR = "$env:LOCALAPPDATA\MoorsteadLedger"

# already up? (t' dedicated profile dir marks our processes out)
$running = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'MoorsteadLedger' }
if ($running) { exit 0 }

$urls = @(
  'http://192.168.1.230:8095/',   # EVO on t' home LAN
  'http://100.90.66.54:8095/'     # EVO ower Tailscale (away frae home)
)
$target = $null
foreach ($u in $urls) {
  try {
    $null = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3
    $target = $u
    break
  } catch { }
}
if (-not $target) { exit 0 } # EVO unreachable — t' watchdog tries again in 2 min

Start-Process msedge -ArgumentList @(
  "--app=$target",
  "--user-data-dir=$PROFILE_DIR",
  '--no-first-run',
  '--window-size=1380,940'
)
