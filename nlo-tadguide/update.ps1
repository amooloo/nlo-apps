# NLO TAD Guide - updater for PCs where .bat files cannot be written (antivirus / IT policy).
# Run it from the Run box (Win + R):
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-tadguide/update.ps1' -UseBasicParsing).Content"
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'
Write-Host ''
Write-Host ' ==============================================='
Write-Host '  NLO TAD Guide - update'
Write-Host ' ==============================================='
$cands = @('C:\NLO\nlo-tadguide', 'C:\nlo-tadguide\nlo-tadguide', 'C:\nlo-tadguide', "$env:USERPROFILE\nlo-tadguide",
           "$env:USERPROFILE\Desktop\nlo-tadguide", "$env:USERPROFILE\Downloads\nlo-tadguide\nlo-tadguide",
           "$env:USERPROFILE\Downloads\nlo-tadguide", 'D:\NLO\nlo-tadguide')
$dst = $cands | Where-Object { Test-Path (Join-Path $_ 'run_app.py') } | Select-Object -First 1
if (-not $dst) { $dst = Read-Host ' App folder not found. Type it (e.g. C:\NLO\nlo-tadguide)' }
Write-Host " App folder: $dst"
$t = Join-Path $env:TEMP 'nlo-tadguide-update'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $t | Out-Null
Write-Host ' [1/4] Downloading the latest version...'
Invoke-WebRequest 'https://github.com/amooloo/nlo-apps/archive/refs/heads/main.zip' -OutFile (Join-Path $t 'main.zip') -UseBasicParsing
Write-Host ' [2/4] Copying the new files in (settings, cases and lessons are kept)...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $t 'main.zip'))
$prefix = 'nlo-apps-main/nlo-tadguide/'
$n = 0; $skipped = @()
foreach ($e in $zip.Entries) {
  if (-not $e.FullName.StartsWith($prefix) -or -not $e.Name) { continue }
  $rel = $e.FullName.Substring($prefix.Length)
  if ($rel -eq 'settings.json' -or $rel -like 'jobs/*' -or $rel -like 'training/*' -or $rel -like 'samples/*') { continue }
  $target = Join-Path $dst ($rel -replace '/', '\')
  $dir = Split-Path $target
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true); $n++ } catch { $skipped += $rel }
}
$zip.Dispose()
Write-Host "       $n files updated."
if ($skipped.Count) { Write-Host "       Not written (blocked on this PC): $($skipped -join ', ')" }
Write-Host ' [3/4] Installing components (may take a minute)...'
# the same Python, in the same order, as _findpy.bat (the one start_app.bat runs the app with)
$py = foreach ($base in "$env:LOCALAPPDATA\Programs\Python\Python", "$env:ProgramFiles\Python", 'C:\Python') {
        foreach ($v in '313', '312', '314', '311') { "$base$v\python.exe" } }
$py = $py | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($py) { & $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r (Join-Path $dst 'requirements.txt') }
else { Write-Host '       (Python 3.11 - 3.14 not found in the usual places - skipped)' }
Write-Host ' [4/4] Restarting the app...'
# Stop the running app precisely: only the python process that holds port 8767, then its console window.
$owners = @()
try { $owners = Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique } catch {}
foreach ($p in $owners) {
  if (-not $p -or $p -le 4 -or $p -eq $PID) { continue }
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.ProcessName -notmatch '^python') { Write-Host "       Port 8767 is held by '$($proc.ProcessName)' (PID $p), not the app - left alone."; continue }
  $parent = $null
  try { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue).ParentProcessId } catch {}
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
  if ($parent -and $parent -gt 4) {
    $pp = Get-Process -Id $parent -ErrorAction SilentlyContinue
    if ($pp -and $pp.ProcessName -eq 'cmd') { Stop-Process -Id $parent -Force -ErrorAction SilentlyContinue }
  }
}
$tries = 0
while ($tries -lt 20 -and (Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
$bat = Join-Path $dst 'start_app.bat'
if (Test-Path $bat) { Start-Process -FilePath $bat -ArgumentList 'autostart' -WorkingDirectory $dst }
elseif ($py) { Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-NoProfile', '-WindowStyle', 'Minimized', '-Command', "& '$py' '$(Join-Path $dst 'run_app.py')' --lan --no-browser" -WorkingDirectory $dst }
else { Write-Host '       Could not start the app (no start_app.bat and no Python found) - restart the PC.' }
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host ' UPDATE DONE. The app is running again (minimised window "NLO TAD Guide"). You can close this window.'
Write-Host ''
