# NLO Tray Maker - let THIS PC open the app's models in PreForm.
#
# The app runs on the lab PC; from any other PC the page cannot start a program by itself. This
# registers a small link handler (nlobt:) for the current Windows user - no admin - so the "Open in
# PreForm on this PC" button hands the model files (on the office share) to the PreForm installed here.
#
# Run once per PC, Win+R:
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/preform_link.ps1' -UseBasicParsing).Content"
#
# Undo: remove HKCU\Software\Classes\nlobt and %LOCALAPPDATA%\nlo-bleachtray\preform_open.ps1

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'nlo-bleachtray'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$handler = Join-Path $dir 'preform_open.ps1'

@'
# Handler for nlobt: links from the NLO Tray Maker page: nlobt://preform?f=<path>&f=<path>
# Opens the listed model files (STL, must exist - normally on the office share) in PreForm on this PC.
param([string]$url)
Add-Type -AssemblyName System.Web
Add-Type -AssemblyName System.Windows.Forms
function Say($m) { [System.Windows.Forms.MessageBox]::Show($m, 'NLO Tray Maker') | Out-Null }
function Find-PreForm {
  foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
    if (-not $b) { continue }
    $f = Join-Path $b 'Formlabs\PreForm'
    if (Test-Path "$f\PreForm.exe") { return "$f\PreForm.exe" }
    $v = Get-ChildItem $f -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'PreForm.exe') } |
         Sort-Object { try { [version]($_.Name -replace '[^\d.]', '') } catch { [version]'0.0' } } -Descending | Select-Object -First 1
    if ($v) { return (Join-Path $v.FullName 'PreForm.exe') }
    if (Test-Path "$f\PreFormLauncher.exe") { return "$f\PreFormLauncher.exe" }
  }
  $null
}
try {
  $u = [uri]$url
  $q = [System.Web.HttpUtility]::ParseQueryString($u.Query)
  $files = @($q.GetValues('f')) | Where-Object { $_ -and ($_ -match '\.stl$') -and (Test-Path -LiteralPath $_) }
  $missing = @($q.GetValues('f')) | Where-Object { $_ -and -not (Test-Path -LiteralPath $_) }
  if (-not $files) { Say ("No model file to open." + $(if ($missing) { "`nNot reachable from this PC:`n" + ($missing -join "`n") + "`n`nThe print folder must be on the office share." } else { '' })); exit }
  $exe = Find-PreForm
  if (-not $exe) { Say "PreForm is not installed on this PC (looked in Program Files\Formlabs\PreForm)."; exit }
  Start-Process -FilePath $exe -ArgumentList (@($files) | ForEach-Object { '"' + $_ + '"' })
} catch { Say ("Could not open PreForm: " + $_.Exception.Message) }
'@ | Set-Content -Path $handler -Encoding UTF8

$k = 'HKCU:\Software\Classes\nlobt'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:NLO Tray Maker'
Set-ItemProperty -Path $k -Name 'URL Protocol' -Value ''
New-Item -Path "$k\DefaultIcon" -Force | Out-Null
$pf = $null
foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) { if ($b -and (Test-Path "$b\Formlabs\PreForm\PreFormLauncher.exe")) { $pf = "$b\Formlabs\PreForm\PreFormLauncher.exe" } }
Set-ItemProperty -Path "$k\DefaultIcon" -Name '(default)' -Value $(if ($pf) { "$pf,0" } else { 'powershell.exe,0' })
New-Item -Path "$k\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value ('powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $handler + '" "%1"')

$found = & { foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) { if ($b -and (Test-Path "$b\Formlabs\PreForm")) { "$b\Formlabs\PreForm" } } } | Select-Object -First 1
Write-Host ''
Write-Host "DONE - this PC ($env:COMPUTERNAME) opens the app's models in PreForm." -ForegroundColor Green
if ($found) { Write-Host "PreForm: $found" } else { Write-Host "NOTE: PreForm was not found under Program Files\Formlabs\PreForm on this PC - install it, then the button works." -ForegroundColor Yellow }
Write-Host "In the browser, the first click shows 'Open NLO Bleach Tray?' - tick 'Always allow' and it never asks again."
