# NLO X-Ray Reader - install it on this PC, or bring it up to date. One line in the Run box (Win + R):
#
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-xray/setup.ps1' -UseBasicParsing).Content"
#
# The same line installs (first time) and updates (any time after): it downloads the app's program files from
# GitHub, installs Python 3.13 for this user if the PC has none (no admin needed), installs the components,
# sets the app to start at sign-in, and (re)starts it. The x-rays, tracings, trained network and settings
# (cases\, models\, settings.json) are never touched, and nothing from this PC is sent anywhere.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell's byte-by-byte progress bar makes a download 10x slower
$PORT = 8766
$NAME = 'NLO X-Ray Reader'
$ZIP_URL = 'https://github.com/amooloo/nlo-apps/archive/refs/heads/main.zip'
$PY_URL = 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe'
$KEEP = @('settings.json', 'sessions.json')          # files of this PC's own that an update never overwrites
$KEEP_DIRS = @('cases/', 'models/')

function Find-App {
  $cands = @('C:\NLO\nlo-xray', 'C:\nlo-xray', "$env:USERPROFILE\nlo-xray", "$env:USERPROFILE\NLO\nlo-xray",
             "$env:USERPROFILE\Desktop\nlo-xray", "$env:USERPROFILE\Downloads\nlo-xray", 'D:\NLO\nlo-xray')
  return ($cands | Where-Object { Test-Path (Join-Path $_ 'run_app.py') } | Select-Object -First 1)
}

function Find-Py {
  $cands = @()
  foreach ($v in @('313', '312', '314', '311')) {
    $cands += "$env:LOCALAPPDATA\Programs\Python\Python$v\python.exe"
    $cands += "$env:ProgramFiles\Python$v\python.exe"
    $cands += "C:\Python$v\python.exe"
  }
  $py = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($py) { return $py }
  foreach ($v in @('3.13', '3.12', '3.14', '3.11')) {
    try { $p = (& py "-$v" -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1); if ($LASTEXITCODE -eq 0 -and $p) { return ([string]$p).Trim() } } catch {}
  }
  return $null
}

function Stop-App {
  # only the python process that holds the app's port, then the console window it runs in - never anything by title
  $owners = @()
  try { $owners = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique } catch {}
  foreach ($p in $owners) {
    if (-not $p -or $p -le 4 -or $p -eq $PID) { continue }
    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^python') { Write-Host "       Port $PORT is held by '$($proc.ProcessName)' (PID $p), not the app - left alone."; continue }
    $parent = $null
    try { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue).ParentProcessId } catch {}
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    if ($parent -and $parent -gt 4) {
      $pp = Get-Process -Id $parent -ErrorAction SilentlyContinue
      if ($pp -and $pp.ProcessName -eq 'cmd') { Stop-Process -Id $parent -Force -ErrorAction SilentlyContinue }
    }
  }
  $tries = 0
  while ($tries -lt 20 -and (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
}

Write-Host ''
Write-Host ' ==============================================='
Write-Host "  $NAME - install / update"
Write-Host ' ==============================================='
$dst = Find-App
$fresh = -not $dst
if ($fresh) {
  $dst = 'C:\NLO\nlo-xray'
  try { New-Item -ItemType Directory -Path $dst -Force -ErrorAction Stop | Out-Null } catch { $dst = "$env:USERPROFILE\NLO\nlo-xray"; New-Item -ItemType Directory -Path $dst -Force | Out-Null }
}
Write-Host " App folder: $dst"

Write-Host ' [1/5] Downloading the latest version...'
$t = Join-Path $env:TEMP 'nlo-xray-setup'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $t | Out-Null
try { Invoke-WebRequest $ZIP_URL -OutFile (Join-Path $t 'main.zip') -UseBasicParsing -ErrorAction Stop }
catch { Write-Host "       Could not download ($_). Is the internet on? Nothing was changed."; return }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $t 'main.zip'))
$prefix = 'nlo-apps-main/nlo-xray/'
$n = 0; $skipped = @()
foreach ($e in $zip.Entries) {
  if (-not $e.FullName.StartsWith($prefix) -or -not $e.Name) { continue }
  $rel = $e.FullName.Substring($prefix.Length)
  if ($KEEP -contains $rel) { continue }
  $isData = $false
  foreach ($k in $KEEP_DIRS) { if ($rel.StartsWith($k)) { $isData = $true } }
  if ($isData) { continue }
  $target = Join-Path $dst ($rel -replace '/', '\')
  $dir = Split-Path $target
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true); $n++ } catch { $skipped += $rel }
}
$zip.Dispose()
if ($n -eq 0) { Write-Host '       The download had no X-Ray Reader files in it - nothing was changed.'; return }
Write-Host "       $n files in place."
if ($skipped.Count) { Write-Host "       Not written (in use or blocked): $($skipped -join ', ')" }

Write-Host ' [2/5] Python (the free program the app runs on)...'
$py = Find-Py
if (-not $py) {
  Write-Host '       Not found - installing Python 3.13 for this user (about a minute, no admin needed)...'
  $inst = Join-Path $t 'python-3.13-amd64.exe'
  try {
    Invoke-WebRequest $PY_URL -OutFile $inst -UseBasicParsing
    $p = Start-Process -FilePath $inst -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0' -Wait -PassThru
    Write-Host "       Installer finished (code $($p.ExitCode))."
  } catch { Write-Host "       Python download / install failed: $_" }
  $py = Find-Py
}
if (-not $py) {
  Write-Host ''
  Write-Host ' Python could not be installed automatically. Install it by hand: https://www.python.org/downloads/ (3.13, "Install Now"),'
  Write-Host ' then run this line again.'
  return
}
Write-Host "       Python: $py"

Write-Host ' [3/5] Components (the first time: a few minutes, ~125 MB for the learning engine)...'
& $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r (Join-Path $dst 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Host '       Something went wrong installing components - take a photo of this window and send it to Dr. Akhavan.' }
& $py -c "import torch" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location torch --index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE -ne 0) { & $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location torch }
  & $py -c "import torch" 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host '       The learning engine (PyTorch) did not install - take a photo of this window and send it to Dr. Akhavan.' }
}

Write-Host ' [4/5] Start at sign-in, firewall...'
$bat = Join-Path $dst 'start_app.bat'
try { Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $NAME -Value "`"$bat`" autostart" -ErrorAction Stop; Write-Host '       The app starts minimised every time this PC signs in.' }
catch { Write-Host "       Autostart could not be set ($_) - double-click start_app.bat after a restart." }
try {
  if (-not (Get-NetFirewallRule -DisplayName $NAME -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $NAME -Direction Inbound -Protocol TCP -LocalPort $PORT -Action Allow -Profile Domain,Private -ErrorAction Stop | Out-Null
  }
  Write-Host '       Firewall: other office computers may reach the app (office network only).'
} catch { Write-Host '       Firewall rule not added (needs an administrator). If Windows asks whether to allow Python, tick Private networks and click Allow.' }

Write-Host ' [5/5] Starting the app...'
Stop-App
Start-Process -FilePath $bat -ArgumentList 'autostart' -WorkingDirectory $dst
$tries = 0
while ($tries -lt 60 -and -not (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
Start-Process "http://127.0.0.1:$PORT/"
Write-Host ''
if ($fresh) { Write-Host " INSTALL DONE. The app runs on this PC (minimised window '$NAME')." } else { Write-Host " UPDATE DONE. The app is running again (minimised window '$NAME'); x-rays, tracings and settings kept." }
Write-Host " Other office computers open it at:   http://$($env:COMPUTERNAME):$PORT"
Write-Host " This computer's name is $env:COMPUTERNAME - the NLO apps home page's X-Ray Reader button should point here."
Write-Host ''
