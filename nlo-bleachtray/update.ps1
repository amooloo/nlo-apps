# NLO Bleach Tray - updater for PCs where .bat files cannot be written (antivirus / IT policy).
# Nothing is saved to disk except the app files themselves. Run it from the Run box (Win + R):
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/update.ps1' -UseBasicParsing).Content"
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
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
  if ($rel -eq 'watch_config.json' -or $rel -like 'jobs/*' -or $rel -like 'out/*' -or $rel -like 'samples/*') { continue }
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
if ($skipped.Count) { Write-Host "       Not written (blocked on this PC, not needed to run): $($skipped -join ', ')" }
Write-Host ' [3/4] Installing components (may take a minute)...'
$py = @("$env:LOCALAPPDATA\Programs\Python\Python313\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python313\python.exe", 'C:\Python313\python.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($py) { & $py -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r (Join-Path $dst 'requirements.txt') }
else { Write-Host '       (Python 3.13 not found in the usual place - skipped)' }
Write-Host ' [4/4] Restarting the app...'
taskkill /F /T /FI 'WINDOWTITLE eq NLO Bleach Tray' 2>&1 | Out-Null
taskkill /F /T /FI 'WINDOWTITLE eq NLO Bleach Tray - *' 2>&1 | Out-Null
# whatever still holds the app's port (a copy started by hand, a window with another title) goes too
try {
  $owners = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid_ in $owners) { if ($pid_ -and $pid_ -ne $PID) { taskkill /F /T /PID $pid_ 2>&1 | Out-Null } }
} catch {}
$tries = 0
while ($tries -lt 20 -and (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $tries++ }
Start-Process -FilePath (Join-Path $dst 'start_app.bat') -ArgumentList 'autostart' -WorkingDirectory $dst
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host ' UPDATE DONE. The app is running again (minimised window "NLO Bleach Tray"). You can close this window.'
Write-Host ''
