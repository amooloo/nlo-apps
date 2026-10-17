# NLO Bleach Tray - move the app to another PC (no .bat files needed). Two lines, each from the Run box (Win + R):
#
#   On the PC that runs the app today - packs the cases and settings onto the S: drive, stops the app, removes autostart:
#     powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$NLO_MOVE='pack'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/move.ps1' -UseBasicParsing).Content"
#
#   On the new PC - installs the app (Python too if needed), takes the packed cases and settings over, starts it, autostart at sign-in:
#     powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$NLO_MOVE='install'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/move.ps1' -UseBasicParsing).Content"
#
# Nothing is saved to disk except the app itself (and the pack on the S: drive). Only one PC should run the app at a time.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$PORT = 8765
$ZIP_URL = 'https://github.com/amooloo/nlo-apps/archive/refs/heads/main.zip'
$PY_URL = 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe'
$PACK_PREFIX = 'BleachTray_move-from-'

function Find-App {
  $cands = @('C:\nlo-bleachtray\nlo-bleachtray', 'C:\nlo-bleachtray', 'C:\NLO\nlo-bleachtray',
             "$env:USERPROFILE\nlo-bleachtray\nlo-bleachtray", "$env:USERPROFILE\nlo-bleachtray",
             "$env:USERPROFILE\Desktop\nlo-bleachtray\nlo-bleachtray", "$env:USERPROFILE\Desktop\nlo-bleachtray",
             "$env:USERPROFILE\Downloads\nlo-bleachtray\nlo-bleachtray", 'D:\nlo-bleachtray\nlo-bleachtray')
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
  # only the python process that holds the app's port, then the console window (cmd / powershell) it runs in
  $owners = @()
  try { $owners = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique } catch {}
  $stopped = $false
  foreach ($p in $owners) {
    if (-not $p -or $p -le 4 -or $p -eq $PID) { continue }
    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^python') { Write-Host "       Port $PORT is held by '$($proc.ProcessName)' (PID $p), not the app - left alone."; continue }
    $parent = $null
    try { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue).ParentProcessId } catch {}
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    $stopped = $true
    if ($parent -and $parent -gt 4) {
      $pp = Get-Process -Id $parent -ErrorAction SilentlyContinue
      if ($pp -and ($pp.ProcessName -eq 'cmd' -or $pp.ProcessName -eq 'powershell')) { Stop-Process -Id $parent -Force -ErrorAction SilentlyContinue }
    }
  }
  $tries = 0
  while ($tries -lt 20 -and (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
  return $stopped
}

function Find-ShareRoot {
  # the office share with "clinical\3D printing" (Titan exports, the drop folder, the pack)
  foreach ($d in @('S', 'O', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'N', 'M', 'L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D')) {
    $r = "${d}:\clinical\3D printing"
    if (Test-Path $r) { return $r }
  }
  return $null
}

function Remove-Autostart {
  try { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'NLO Bleach Tray' -ErrorAction SilentlyContinue } catch {}
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'NLO Bleach Tray.lnk'
  if (Test-Path $lnk) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
}

$mode = $NLO_MOVE
if (-not $mode) {
  $running = $null -ne (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)
  $guess = if ($running -or (Find-App)) { 'pack' } else { 'install' }
  $mode = Read-Host " Is this the OLD PC (pack up and stop the app) or the NEW PC (install)? [pack/install, Enter = $guess]"
  if (-not $mode) { $mode = $guess }
}
$mode = $mode.Trim().ToLower()

Write-Host ''
Write-Host ' ==============================================='
if ($mode -eq 'pack') { Write-Host '  NLO Bleach Tray - pack up this PC (the app moves away)' } else { Write-Host '  NLO Bleach Tray - install on this PC' }
Write-Host ' ==============================================='

# ----------------------------------------------------------------------------------------------- pack
if ($mode -eq 'pack') {
  $dst = Find-App
  if (-not $dst) { $dst = Read-Host ' The app folder was not found on this PC. Type it (e.g. C:\nlo-bleachtray\nlo-bleachtray), or just press Enter to stop' }
  if (-not $dst -or -not (Test-Path (Join-Path $dst 'run_app.py'))) { Write-Host ' Nothing to pack on this PC.'; return }
  Write-Host " App folder: $dst"
  $root = $null
  $cfgPath = Join-Path $dst 'watch_config.json'
  if (Test-Path $cfgPath) {
    try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json; if ($cfg.titan -and (Test-Path $cfg.titan)) { $root = Split-Path $cfg.titan -Parent } } catch {}
  }
  if (-not $root) { $root = Find-ShareRoot }
  if (-not $root) { $root = Read-Host ' The office share (S:\clinical\3D printing) was not found. Type a folder both PCs can see' }
  $pack = Join-Path $root ($PACK_PREFIX + $env:COMPUTERNAME)
  Write-Host " Pack folder: $pack"
  Write-Host ' [1/3] Stopping the app and removing autostart on this PC...'
  $was = Stop-App
  Remove-Autostart
  if ($was) { Write-Host '       App stopped.' } else { Write-Host '       (the app was not running)' }
  Write-Host ' [2/3] Copying the cases, lessons, settings and the base to the pack folder...'
  New-Item -ItemType Directory -Path $pack -Force | Out-Null
  foreach ($sub in @('jobs', 'training')) {
    $src = Join-Path $dst $sub
    if (Test-Path $src) { & robocopy $src (Join-Path $pack $sub) /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null; Write-Host "       $sub copied." }
  }
  New-Item -ItemType Directory -Path (Join-Path $pack 'assets') -Force | Out-Null
  Get-ChildItem (Join-Path $dst 'assets') -Filter 'trimlign_base_*' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $pack 'assets') -Force }
  if (Test-Path $cfgPath) { Copy-Item $cfgPath (Join-Path $pack 'watch_config.json') -Force }
  # a model this PC retrained itself is worth more than the shipped one
  $st = Join-Path $dst 'training\_learn\status.json'
  if (Test-Path $st) {
    try { $o = Get-Content $st -Raw | ConvertFrom-Json; if ($o.outcome -eq 'accepted' -and (Test-Path (Join-Path $dst 'assets\models.joblib'))) { Copy-Item (Join-Path $dst 'assets\models.joblib') (Join-Path $pack 'assets\models.joblib') -Force; Write-Host '       The model this PC retrained itself goes too.' } } catch {}
  }
  Set-Content -Path (Join-Path $pack 'PACKED_FROM.txt') -Value "$env:COMPUTERNAME $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  Write-Host ' [3/3] Done.'
  Write-Host ''
  Write-Host " PACKED. This PC no longer runs the app. Now run the install line on the new PC (it takes the pack from $pack)."
  Write-Host ' The app folder stays here untouched in case anything is needed later.'
  Write-Host ''
  return
}

# ----------------------------------------------------------------------------------------------- install
if ($mode -ne 'install') { Write-Host " Unknown mode '$mode' - use pack or install."; return }
$dst = Find-App
if ($dst) { Write-Host " The app is already in $dst - it will be brought up to date and the pack taken in." }
else {
  $dst = 'C:\nlo-bleachtray\nlo-bleachtray'
  try { New-Item -ItemType Directory -Path $dst -Force -ErrorAction Stop | Out-Null } catch { $dst = "$env:USERPROFILE\nlo-bleachtray\nlo-bleachtray"; New-Item -ItemType Directory -Path $dst -Force | Out-Null }
}
Write-Host " App folder: $dst"

Write-Host ' [1/6] Downloading the latest version...'
$t = Join-Path $env:TEMP 'nlo-bleachtray-install'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $t | Out-Null
Invoke-WebRequest $ZIP_URL -OutFile (Join-Path $t 'main.zip') -UseBasicParsing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $t 'main.zip'))
$prefix = 'nlo-apps-main/nlo-bleachtray/'
$n = 0; $skipped = @()
foreach ($e in $zip.Entries) {
  if (-not $e.FullName.StartsWith($prefix) -or -not $e.Name) { continue }
  $rel = $e.FullName.Substring($prefix.Length)
  if ($rel -eq 'watch_config.json' -or $rel -like 'jobs/*' -or $rel -like 'out/*' -or $rel -like 'samples/*' -or $rel -like 'training/*') { continue }
  $target = Join-Path $dst ($rel -replace '/', '\')
  $dir = Split-Path $target
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true); $n++ } catch { $skipped += $rel }
}
$zip.Dispose()
Write-Host "       $n files in place."
if ($skipped.Count) { Write-Host "       Not written (blocked on this PC, not needed to run): $($skipped -join ', ')" }

Write-Host ' [2/6] Python (the free program the app runs on)...'
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
  Write-Host ' then run this install line again. Nothing else was lost.'
  return
}
Write-Host "       Python: $py"

Write-Host ' [3/6] Installing the app''s components (2-5 minutes, needs internet)...'
& $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r (Join-Path $dst 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Host '       Something went wrong installing components - take a photo of this window and send it to Dr. Akhavan.' }

Write-Host ' [4/6] Cases, settings and the base...'
$root = Find-ShareRoot
$pack = $null
if ($root) { $pack = Get-ChildItem $root -Directory -Filter ($PACK_PREFIX + '*') -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*-taken-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
if ($pack) {
  $old = $pack.Name.Substring($PACK_PREFIX.Length)
  Write-Host "       Pack from $old found: $($pack.FullName)"
  # the old PC must not still be serving the app (two watchers would make duplicate orders)
  $alive = $false
  try { $r = Invoke-WebRequest "http://${old}:$PORT/api/jobs" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $alive = $true } } catch {}
  if ($alive) {
    Write-Host ''
    Write-Host " STOP: $old is still running the app. Run the pack line on $old first (it stops the app there), then this line again."
    return
  }
  & robocopy $pack.FullName $dst /E /XF PACKED_FROM.txt /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  Write-Host '       Cases, lessons, settings and the base taken over.'
  try { Rename-Item $pack.FullName ($pack.Name + '-taken-' + (Get-Date -Format 'yyyyMMdd-HHmm')) -ErrorAction SilentlyContinue } catch {}
  # the pack's drop folder / Titan folder must exist as seen from THIS PC
  $cfgPath = Join-Path $dst 'watch_config.json'
  try {
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    if ($cfg.titan -and -not (Test-Path $cfg.titan)) { Write-Host "       NOTE: the OrthoFactory folder from the old PC ($($cfg.titan)) is not visible from here - set it under Advanced settings in the app." }
    if ($cfg.scanner_folder) {
      $gone = @($cfg.scanner_folder -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not (Test-Path $_) })
      if ($gone.Count) { Write-Host "       NOTE: the scanner export folder ($($gone -join '; ')) is not visible from here - set it under Settings in the app." }
    }
  } catch {}
} else {
  Write-Host '       No pack found on the office share - a fresh setup.'
  $titan = $null
  if ($root -and (Test-Path (Join-Path $root 'Titan'))) { $titan = Join-Path $root 'Titan' }
  if (-not $titan) { $titan = Read-Host ' Type the full path of the Titan folder (where Titan exports go, OrthoFactory''s input folder)' }
  if ($titan -and -not (Test-Path (Join-Path $dst 'assets\trimlign_base_manifold.ply'))) {
    Write-Host '       Learning the Trimlign base from an existing Titan export (about a minute)...'
    & $py (Join-Path $dst 'tools\import_base.py') $titan
    if ($LASTEXITCODE -ne 0) { Write-Host '       No Titan export with the base was found there. Export any case from Titan with the base, then run this line again.' }
  }
  if ($titan) {
    $inbox = Join-Path (Split-Path $titan -Parent) 'BleachTray'
    if (-not (Test-Path $inbox)) { New-Item -ItemType Directory -Path $inbox -Force | Out-Null }
    & $py (Join-Path $dst 'tools\write_config.py') $inbox $titan
    Write-Host "       Drop folder: $inbox"
  }
}

Write-Host ' [5/6] Start at sign-in, firewall...'
$bat = Join-Path $dst 'start_app.bat'
if (Test-Path $bat) { $cmd = "`"$bat`" autostart" }
else { $cmd = "powershell -NoExit -NoProfile -WindowStyle Minimized -Command `"& '$py' '$(Join-Path $dst 'run_app.py')' --lan --no-browser`"" }
try { Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'NLO Bleach Tray' -Value $cmd -ErrorAction Stop; Write-Host '       The app starts minimised every time this PC signs in.' }
catch { Write-Host "       Autostart could not be set ($_) - start it by hand after a restart." }
try {
  if (-not (Get-NetFirewallRule -DisplayName 'NLO Bleach Tray' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'NLO Bleach Tray' -Direction Inbound -Protocol TCP -LocalPort $PORT -Action Allow -Profile Domain,Private -ErrorAction Stop | Out-Null
  }
  Write-Host '       Firewall: other office computers may reach the app.'
} catch { Write-Host '       Firewall rule not added (needs an administrator). If Windows asks whether to allow Python through the firewall, click Allow.' }

Write-Host ' [6/6] Starting the app...'
Stop-App | Out-Null
if (Test-Path $bat) { Start-Process -FilePath $bat -ArgumentList 'autostart' -WorkingDirectory $dst }
else { Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-NoProfile', '-WindowStyle', 'Minimized', '-Command', "& '$py' '$(Join-Path $dst 'run_app.py')' --lan --no-browser" -WorkingDirectory $dst }
$tries = 0
while ($tries -lt 40 -and -not (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
Start-Process "http://127.0.0.1:$PORT/"
Write-Host ''
Write-Host " INSTALL DONE. The app runs on this PC (minimised window 'NLO Bleach Tray')."
Write-Host " Other office computers open it at:   http://$($env:COMPUTERNAME):$PORT"
Write-Host " Tell Dr. Akhavan this computer's name - $env:COMPUTERNAME - so the NLO apps home page points here."
Write-Host ''
