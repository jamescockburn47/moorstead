# Moorstead Parish Ledger watchdog — keeps t' ledger window up, allus.
# A resident loop: every 2 minutes it runs t' launcher, which does nowt if
# t' window's already open, reopens it if it's been closed, an' waits
# quietly if t' EVO's unreachable. One copy per login (self-deduping);
# started hidden by t' Startup shortcut.
$me = $PID
$dupes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'powershell' -and $_.ProcessId -ne $me -and $_.CommandLine -match 'parish-dashboard-watchdog\.ps1' }
if ($dupes) { exit 0 }

while ($true) {
  try { & "$PSScriptRoot\parish-dashboard.ps1" } catch { }
  Start-Sleep -Seconds 120
}
