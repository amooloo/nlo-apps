# NLO Bleach Tray - updater for PCs where .bat files cannot be written (antivirus / IT policy).
# Nothing is saved to disk except the app files themselves. Run it from the Run box (Win + R):
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/update.ps1' -UseBasicParsing).Content"
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell's byte-by-byte progress bar makes a download 10x slower
Write-Host ''
Write-Host ' ==============================================='
Write-Host '  NLO Bleach Tray - update'
Write-Host ' ==============================================='
$cands = @('C:\nlo-bleachtray\nlo-bleachtray', 'C:\nlo-bleachtray', 'C:\NLO\nlo-bleachtray',
           "$env:USERPROFILE\nlo-bleachtray\nlo-bleachtray", "$env:USERPROFILE\nlo-bleachtray",
           "$env:USERPROFILE\Desktop\nlo-bleachtray\nlo-bleachtray", "$env:USERPROFILE\Desktop\nlo-bleachtray",
           "$env:USERPROFILE\Downloads\nlo-bleachtray\nlo-bleachtray", 'D:\nlo-bleachtray\nlo-bleachtray')
$dst = $cands | Where-Object { Test-Path (Join-Path $_ 'run_app.py') } | Select-Object -First 1
if (-not $dst) { $dst = Read-Host ' App folder not found. Type it (e.g. C:\nlo-bleachtray\nlo-bleachtray)' }
Write-Host " App folder: $dst"
$t = Join-Path $env:TEMP 'nlo-bleachtray-update'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $t | Out-Null
Write-Host ' [1/4] Downloading the latest version...'
Invoke-WebRequest 'https://github.com/amooloo/nlo-apps/archive/refs/heads/main.zip' -OutFile (Join-Path $t 'main.zip') -UseBasicParsing
Write-Host ' [2/4] Copying the new files in (settings, the base and finished cases are kept)...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $t 'main.zip'))
$prefix = 'nlo-apps-main/nlo-bleachtray/'
$n = 0; $skipped = @()
foreach ($e in $zip.Entries) {
  if (-not $e.FullName.StartsWith($prefix) -or -not $e.Name) { continue }
  $rel = $e.FullName.Substring($prefix.Length)
  if ($rel -eq 'watch_config.json' -or $rel -like 'jobs/*' -or $rel -like 'out/*' -or $rel -like 'samples/*' -or $rel -like 'training/*') { continue }
  # a model the app retrained itself on this PC (training/_learn) is newer than the shipped one: keep it
  if ($rel -eq 'assets/models.joblib' -and (Test-Path (Join-Path $dst 'training\_learn\status.json'))) {
    try { $st = Get-Content (Join-Path $dst 'training\_learn\status.json') -Raw | ConvertFrom-Json; if ($st.outcome -eq 'accepted') { $kept_model = $true; continue } } catch {}
  }
  $target = Join-Path $dst ($rel -replace '/', '\')
  $dir = Split-Path $target
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try {
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
    $n++
  } catch {
    $skipped += $rel
  }
}
$zip.Dispose()
Write-Host "       $n files updated."
if ($kept_model) { Write-Host '       The model this PC retrained itself was kept (newer than the shipped one).' }
if ($skipped.Count) { Write-Host "       Not written (blocked on this PC, not needed to run): $($skipped -join ', ')" }
Write-Host ' [3/4] Installing components (may take a minute)...'
$py = @("$env:LOCALAPPDATA\Programs\Python\Python313\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python313\python.exe", 'C:\Python313\python.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($py) { & $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r (Join-Path $dst 'requirements.txt') }
else { Write-Host '       (Python 3.13 not found in the usual place - skipped)' }
Write-Host ' [4/4] Restarting the app...'
# Stop the running app precisely: only the python process that holds the app's port, then the console
# window (cmd.exe) it runs in. Nothing is ever selected by window title any more - that once took the
# Windows shell (explorer.exe) down with it, which leaves a black desktop with just a mouse pointer
# until explorer.exe is started again from Task Manager.
$owners = @()
try { $owners = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique } catch {}
foreach ($p in $owners) {
  if (-not $p -or $p -le 4 -or $p -eq $PID) { continue }
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.ProcessName -notmatch '^python') { Write-Host "       Port 8765 is held by '$($proc.ProcessName)' (PID $p), not the app - left alone."; continue }
  $parent = $null
  try { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue).ParentProcessId } catch {}
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
  if ($parent -and $parent -gt 4) {
    $pp = Get-Process -Id $parent -ErrorAction SilentlyContinue
    if ($pp -and $pp.ProcessName -eq 'cmd') { Stop-Process -Id $parent -Force -ErrorAction SilentlyContinue }
  }
}
$tries = 0
while ($tries -lt 20 -and (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
$bat = Join-Path $dst 'start_app.bat'
if (Test-Path $bat) { Start-Process -FilePath $bat -ArgumentList 'autostart' -WorkingDirectory $dst }
elseif ($py) { Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-NoProfile', '-WindowStyle', 'Minimized', '-Command', "& '$py' '$(Join-Path $dst 'run_app.py')' --lan --no-browser" -WorkingDirectory $dst }
else { Write-Host '       Could not start the app (no start_app.bat and no Python found) - restart the PC.' }
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host ' UPDATE DONE. The app is running again (minimised window "NLO Bleach Tray"). You can close this window.'
Write-Host ''
