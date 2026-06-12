# Moorstead Parish Ledger — standalone dashboard window for James's PC.
# Probes t' EVO on LAN first (fast at home), Tailscale if away, then opens
# an Edge app-mode window (own taskbar entry, no browser chrome).
# Installed to run at login via a Startup shortcut; desktop shortcut re-opens it.
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
if (-not $target) { $target = $urls[0] } # open owt road — Edge shows t' error, refresh when t' EVO's back
Start-Process msedge -ArgumentList "--app=$target", "--window-size=1380,940"
