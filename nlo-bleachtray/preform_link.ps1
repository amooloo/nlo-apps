# NLO Tray Maker - let THIS PC open the app's models in PreForm.
#
# The app runs on the lab PC; from any other PC the page cannot start a program by itself. This
# registers a small link handler (nlobt:) for the current Windows user - no admin - so the "Open in
# PreForm on this PC" button hands the model files (on the office share) to the PreForm installed here.
#
# Run once per PC, Win+R (run it again any time: it replaces the handler with the current one):
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/preform_link.ps1' -UseBasicParsing).Content"
#
# What happens on a click: the browser asks "Open NLO Tray Maker?" the first time (tick Always allow), Windows
# runs the handler without a window (through a tiny wscript launcher, so no console flashes), the handler waits
# for the model files to appear on the share (the app writes them right after the click) and starts PreForm with
# them. Every run is written to %LOCALAPPDATA%\nlo-bleachtray\preform_open.log, and anything that stops it is
# said in a message box on top of every window - never silently.
#
# Undo: remove HKCU\Software\Classes\nlobt and the folder %LOCALAPPDATA%\nlo-bleachtray

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'nlo-bleachtray'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$handler = Join-Path $dir 'preform_open.ps1'
$launcher = Join-Path $dir 'preform_open.vbs'
$logfile = Join-Path $dir 'preform_open.log'

@'
# Handler for nlobt: links from the NLO Tray Maker page: nlobt://preform?f=<path>&f=<path>[&wait=<seconds>]
# Opens the listed model files (STL, on the office share) in PreForm on this PC. The page sends the link the
# moment the button is clicked and has the app write the files right after, so the handler waits for them
# (up to `wait` seconds, 45 by default). Everything it does goes to preform_open.log next to this file.
param([string]$url)
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'preform_open.log'
function Log($m) { try { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {} }
function Say($m) {
  Log ("SAID: " + ($m -replace "`n", ' | '))
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $top = New-Object System.Windows.Forms.Form; $top.TopMost = $true; $top.ShowInTaskbar = $false   # (never shown: only the owner that keeps the box on top)
    [System.Windows.Forms.MessageBox]::Show($top, ($m + "`n`nLog: " + $log), 'NLO Tray Maker - PreForm') | Out-Null
    $top.Dispose()
  } catch { try { (New-Object -ComObject WScript.Shell).Popup(($m + "`n`nLog: " + $log), 0, 'NLO Tray Maker - PreForm', 0x1000) | Out-Null } catch {} }
}
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
  # the registry's App Paths entry, when PreForm was installed somewhere else
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe')) {
    try { $p = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'; if ($p -and (Test-Path $p)) { return $p } } catch {}
  }
  $null
}
# the query string by hand (System.Web is not always there): f=<url-encoded path>, repeated
function Parse-Query($u) {
  $q = $u; $i = $q.IndexOf('?'); if ($i -ge 0) { $q = $q.Substring($i + 1) } else { $q = '' }
  $q = $q.TrimEnd('/')
  $out = @{ f = @(); wait = 45 }
  foreach ($part in ($q -split '&')) {
    if (-not $part) { continue }
    $kv = $part -split '=', 2
    $k = [uri]::UnescapeDataString($kv[0]); $v = if ($kv.Count -gt 1) { [uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
    if ($k -eq 'f') { $out.f += $v } elseif ($k -eq 'wait') { try { $out.wait = [int]$v } catch {} }
  }
  $out
}
try {
  Log ("link: " + $url)
  if (-not $url) { Say "The link came without the model files (the browser passed nothing). Click the button again."; exit }
  $q = Parse-Query $url
  $want = @($q.f | Where-Object { $_ -and ($_ -match '\.stl$') })
  Log ("files asked for: " + ($want -join ' ; '))
  if (-not $want) { Say ("The link named no model file (.stl):`n" + $url); exit }
  $exe = Find-PreForm
  Log ("PreForm: " + $(if ($exe) { $exe } else { 'NOT FOUND' }))
  if (-not $exe) { Say "PreForm is not installed on this PC (looked in Program Files\Formlabs\PreForm). Install PreForm here, or use the button's 'on the lab PC' half."; exit }
  # the app writes the files right after the click: wait for them (a share can take a moment to show a new file)
  $deadline = (Get-Date).AddSeconds([math]::Max(5, [math]::Min(180, $q.wait)))
  $have = @(); $missing = @($want)
  while ($true) {
    $have = @($want | Where-Object { Test-Path -LiteralPath $_ })
    $missing = @($want | Where-Object { -not (Test-Path -LiteralPath $_) })
    if (-not $missing -or (Get-Date) -gt $deadline) { break }
    Start-Sleep -Milliseconds 700
  }
  # a file still being copied: wait until its size holds still
  foreach ($f in $have) { $last = -1; for ($i = 0; $i -lt 40; $i++) { try { $n = (Get-Item -LiteralPath $f).Length } catch { $n = -2 }; if ($n -gt 0 -and $n -eq $last) { break }; $last = $n; Start-Sleep -Milliseconds 400 } }
  Log ("found: " + ($have -join ' ; ') + "   missing: " + ($missing -join ' ; '))
  if (-not $have) {
    $hint = if (($missing -join ' ') -match '^[A-Za-z]:') { "`n`nThese are drive-letter paths of the lab PC, not share paths (\\server\...). On the lab PC, Settings -> Print folder: type the folder as \\server\share\... so every PC can reach it." } else { "`n`nThis PC cannot see them on the office share: check that the share is reachable from here (open the folder in Explorer once)." }
    Say ("No model file to open. Not reachable from this PC after waiting:`n" + ($missing -join "`n") + $hint); exit
  }
  $args_ = @($have | ForEach-Object { '"' + $_ + '"' })
  Log ("starting: " + $exe + ' ' + ($args_ -join ' '))
  Start-Process -FilePath $exe -ArgumentList $args_
  Log "started"
  if ($missing) { Say ("PreForm opened " + $have.Count + " model(s); " + $missing.Count + " not reachable from this PC:`n" + ($missing -join "`n")) }
} catch { Say ("Could not open PreForm: " + $_.Exception.Message) }
'@ | Set-Content -Path $handler -Encoding UTF8

# a wscript launcher runs the handler with no console window at all (powershell -WindowStyle Hidden still flashes one)
@'
' NLO Tray Maker: starts the nlobt: link handler (preform_open.ps1) without a window
Dim sh, args, i, cmd
Set sh = CreateObject("WScript.Shell")
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "preform_open.vbs", "preform_open.ps1") & """" & args
sh.Run cmd, 0, False
'@ | Set-Content -Path $launcher -Encoding ASCII

$k = 'HKCU:\Software\Classes\nlobt'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:NLO Tray Maker'
Set-ItemProperty -Path $k -Name 'URL Protocol' -Value ''
New-Item -Path "$k\DefaultIcon" -Force | Out-Null
$pf = $null
foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) { if ($b -and (Test-Path "$b\Formlabs\PreForm\PreFormLauncher.exe")) { $pf = "$b\Formlabs\PreForm\PreFormLauncher.exe" } }
Set-ItemProperty -Path "$k\DefaultIcon" -Name '(default)' -Value $(if ($pf) { "$pf,0" } else { 'powershell.exe,0' })
New-Item -Path "$k\shell\open\command" -Force | Out-Null
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (Test-Path $wscript) {
  Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value ('"' + $wscript + '" //B //Nologo "' + $launcher + '" "%1"')
} else {
  Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value ('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $handler + '" "%1"')
}
Add-Content -Path $logfile -Value ("{0}  handler installed by preform_link.ps1 on {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $env:COMPUTERNAME)

$found = & { foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) { if ($b -and (Test-Path "$b\Formlabs\PreForm")) { "$b\Formlabs\PreForm" } } } | Select-Object -First 1
Write-Host ''
Write-Host "DONE - this PC ($env:COMPUTERNAME) opens the app's models in PreForm." -ForegroundColor Green
if ($found) { Write-Host "PreForm: $found" } else { Write-Host "NOTE: PreForm was not found under Program Files\Formlabs\PreForm on this PC - install it, then the button works." -ForegroundColor Yellow }
Write-Host "Handler: $handler   (log of every click: $logfile)"
Write-Host "In the browser, the first click shows 'Open NLO Tray Maker?' - tick 'Always allow' and it never asks again."
Write-Host "Test it now: " -NoNewline; Write-Host "Start-Process 'nlobt://preform?f=C:%5Cnothing.stl&wait=5'" -ForegroundColor Cyan; Write-Host "  (a message box saying the file is not reachable means the handler runs)"
