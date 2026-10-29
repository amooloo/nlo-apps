# NLO Tray Maker - let THIS PC open the app's models in PreForm.
#
# The app runs on the lab PC; from any other PC the page cannot start a program by itself. This registers a small
# link handler (nlobt:) for the current Windows user, so the "Open in PreForm on this PC" button hands the model
# files (on the office share) to the PreForm installed here.
#
# Run once per PC, Win+R (run it again any time: it replaces the handler with the current one):
#   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/preform_link.ps1' -UseBasicParsing).Content"
#
# What it does (10/29/2026 - the doctor: "when I click open, nothing happens"; the old handler was a PowerShell
# script behind a wscript launcher, and on his PC Windows never let it run - its log had not one click in it):
#  1. builds the handler, nlobt.exe, from nlobt.cs with the C# compiler that comes with Windows (no admin, nothing
#     downloaded as a program); the PowerShell handler is kept only as the fallback when it cannot be built
#  2. registers nlobt: for this Windows user (HKCU), shown in the browser as "NLO Tray Maker"
#  3. CHECKS that Windows really starts it from a link (a self-test link; no browser involved) and says so
#  4. stops the browser asking "Open NLO Tray Maker?" on every click: the page is http://lab:8765 (not https), and
#     for such a page Edge and Chrome never offer "Always allow". The AutoLaunchProtocolsFromOrigins policy lets
#     nlobt: links from the Tray Maker's address open without the question - only nlobt:, only from lab. Policies
#     live in HKLM, so Windows asks for an administrator's OK once (cancel it and the browser just keeps asking)
#
# Every click is written to %LOCALAPPDATA%\nlo-bleachtray\preform_open.log, and anything that stops the handler is
# said in a message box on top of every window - never silently. The handler also tells the Tray Maker page how it
# went, so the page says "Opened in PreForm on <PC>" or what stopped it.
#
# Undo: remove HKCU\Software\Classes\nlobt, the folder %LOCALAPPDATA%\nlo-bleachtray, and (admin) the value
# AutoLaunchProtocolsFromOrigins under HKLM\SOFTWARE\Policies\Microsoft\Edge (and ...\Google\Chrome).

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$dir = Join-Path $env:LOCALAPPDATA 'nlo-bleachtray'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir 'nlobt.exe'
$src = Join-Path $dir 'nlobt.cs'
$handler = Join-Path $dir 'preform_open.ps1'
$launcher = Join-Path $dir 'preform_open.vbs'
$logfile = Join-Path $dir 'preform_open.log'
$srcUrl = 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/nlobt.cs'
# the Tray Maker's address: the only page whose nlobt: links open without the browser's question
$origins = @('http://lab:8765', 'lab')

function Note($m) { try { Add-Content -Path $logfile -Value ("{0}  setup: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {} }
function Line($ok, $m) {
  if ($ok -eq $true) { Write-Host '  [OK]   ' -ForegroundColor Green -NoNewline } elseif ($ok -eq $false) { Write-Host '  [!!]   ' -ForegroundColor Red -NoNewline } else { Write-Host '  [--]   ' -ForegroundColor Yellow -NoNewline }
  Write-Host $m
}
Write-Host ''
Write-Host "NLO Tray Maker - setting up 'Open in PreForm on this PC' on $env:COMPUTERNAME" -ForegroundColor Cyan
Note "started on $env:COMPUTERNAME"

# ---------------------------------------------------------------------------------------------------------------
# 1. the handler: nlobt.exe, built here from nlobt.cs
# ---------------------------------------------------------------------------------------------------------------
$built = $false; $buildWhy = ''
try {
  $cs = $null
  if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'nlobt.cs'))) { $cs = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'nlobt.cs') -Raw }
  else { $cs = (Invoke-WebRequest -Uri $srcUrl -UseBasicParsing).Content }
  if (-not $cs -or $cs -notmatch 'class NloBt') { throw 'the handler source did not download' }
  Set-Content -LiteralPath $src -Value $cs -Encoding UTF8
  Get-Process -Name 'nlobt' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $tmp = Join-Path $dir 'nlobt.new.exe'
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  $csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($csc) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'      # (a compiler line on stderr is not a stop)
    $out = & $csc /nologo /target:winexe /optimize+ "/out:$tmp" "$src" 2>&1
    $code = $LASTEXITCODE; $ErrorActionPreference = $eap
    if ($code -ne 0 -or -not (Test-Path -LiteralPath $tmp)) { $buildWhy = "compiler: " + (($out | Out-String).Trim()) }
  }
  if (-not (Test-Path -LiteralPath $tmp)) {
    try { Add-Type -TypeDefinition $cs -OutputAssembly $tmp -OutputType WindowsApplication -ErrorAction Stop } catch { $buildWhy = ($buildWhy + ' / Add-Type: ' + $_.Exception.Message).Trim(' /') }
  }
  if (Test-Path -LiteralPath $tmp) { Move-Item -LiteralPath $tmp -Destination $exe -Force; $built = $true }
} catch { $buildWhy = ($buildWhy + ' ' + $_.Exception.Message).Trim() }
if ($built) { Line $true "Handler built: $exe"; Note "handler built: $exe" }
else { Line $null "Could not build the handler here ($buildWhy) - using the PowerShell handler instead"; Note "build failed: $buildWhy" }

# the PowerShell handler: only when nlobt.exe could not be built
if (-not $built) {
@'
# Fallback handler for nlobt: links from the NLO Tray Maker page (used only when nlobt.exe could not be built):
# nlobt://preform?f=<path>&f=<path>[&wait=<seconds>][&t=<token>&cb=<app address>]   |   nlobt://selftest?t=<token>
param([string]$url)
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'preform_open.log'
function Log($m) { try { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {} }
function Say($m) {
  Log ("SAID: " + ($m -replace "`n", ' | '))
  try { (New-Object -ComObject WScript.Shell).Popup(($m + "`n`nLog: " + $log), 0, 'NLO Tray Maker - PreForm', 0x1030) | Out-Null } catch {}
}
function Parse-Query($u) {
  $q = $u; $i = $q.IndexOf('?'); if ($i -ge 0) { $q = $q.Substring($i + 1) } else { $q = '' }
  $q = $q.TrimEnd('/')
  $out = @{ f = @(); wait = 45; t = ''; cb = '' }
  foreach ($part in ($q -split '&')) {
    if (-not $part) { continue }
    $kv = $part -split '=', 2
    $k = [uri]::UnescapeDataString($kv[0]); $v = if ($kv.Count -gt 1) { [uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
    if ($k -eq 'f') { $out.f += $v } elseif ($k -eq 'wait') { try { $out.wait = [int]$v } catch {} } elseif ($k -eq 't') { $out.t = $v } elseif ($k -eq 'cb') { $out.cb = $v }
  }
  $out
}
function Ack($q, $s, $msg, $n) {
  if (-not $q.t -or $q.cb -notmatch '^https?://[^/?#]+') { return }
  $base = $Matches[0]
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri ($base + '/api/preform/ack?t=' + [uri]::EscapeDataString($q.t) + '&s=' + $s + '&pc=' + [uri]::EscapeDataString($env:COMPUTERNAME) + '&n=' + $n + '&v=ps&msg=' + [uri]::EscapeDataString(($msg + '').Substring(0, [math]::Min(400, ($msg + '').Length)))) | Out-Null } catch { Log ("could not tell the page: " + $_.Exception.Message) }
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
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe')) {
    try { $p = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'; if ($p -and (Test-Path $p)) { return $p } } catch {}
  }
  $null
}
$q = $null
try {
  Log ("link: " + $url + "   (PowerShell handler)")
  if ($url -match '^nlobt:/*selftest') { $t = ([regex]::Match($url, '[?&]t=([^&/]+)')).Groups[1].Value; Log ("selftest " + $t + " ok"); exit }
  $q = Parse-Query $url
  Ack $q 'started' '' 0
  $want = @($q.f | Where-Object { $_ -and ($_ -match '\.stl$') })
  if (-not $want) { $m = "The link named no model file (.stl):`n" + $url; Ack $q 'error' $m 0; Say $m; exit }
  $exe = Find-PreForm
  Log ("PreForm: " + $(if ($exe) { $exe } else { 'NOT FOUND' }))
  if (-not $exe) { $m = "PreForm is not installed on this PC (looked in Program Files\Formlabs\PreForm). Install PreForm here, or use the button's 'on lab' half."; Ack $q 'error' $m 0; Say $m; exit }
  $deadline = (Get-Date).AddSeconds([math]::Max(5, [math]::Min(180, $q.wait)))
  while ($true) {
    $have = @($want | Where-Object { Test-Path -LiteralPath $_ }); $missing = @($want | Where-Object { -not (Test-Path -LiteralPath $_) })
    if (-not $missing -or (Get-Date) -gt $deadline) { break }
    Start-Sleep -Milliseconds 700
  }
  foreach ($f in $have) { $last = -1; for ($i = 0; $i -lt 40; $i++) { try { $n = (Get-Item -LiteralPath $f).Length } catch { $n = -2 }; if ($n -gt 0 -and $n -eq $last) { break }; $last = $n; Start-Sleep -Milliseconds 400 } }
  Log ("found: " + ($have -join ' ; ') + "   missing: " + ($missing -join ' ; '))
  if (-not $have) { $m = "No model file to open - not reachable from this PC after waiting:`n" + ($missing -join "`n"); Ack $q 'error' $m 0; Say $m; exit }
  Start-Process -FilePath $exe -ArgumentList @($have | ForEach-Object { '"' + $_ + '"' })
  Log "started"; Ack $q 'opened' '' $have.Count
} catch { $m = "Could not open PreForm: " + $_.Exception.Message; if ($q) { Ack $q 'error' $m 0 }; Say $m }
'@ | Set-Content -Path $handler -Encoding UTF8
@'
' NLO Tray Maker: starts the nlobt: link handler (preform_open.ps1) without a window - the fallback only
Dim sh, args, i, cmd
Set sh = CreateObject("WScript.Shell")
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "preform_open.vbs", "preform_open.ps1") & """" & args
sh.Run cmd, 0, False
'@ | Set-Content -Path $launcher -Encoding ASCII
} else {
  Remove-Item -LiteralPath $handler, $launcher -Force -ErrorAction SilentlyContinue      # the old handler, replaced
}

# ---------------------------------------------------------------------------------------------------------------
# 2. nlobt: for this Windows user
# ---------------------------------------------------------------------------------------------------------------
$pfDir = & { foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) { if ($b -and (Test-Path "$b\Formlabs\PreForm")) { "$b\Formlabs\PreForm" } } } | Select-Object -First 1
$k = 'HKCU:\Software\Classes\nlobt'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:NLO Tray Maker'
Set-ItemProperty -Path $k -Name 'URL Protocol' -Value ''
New-Item -Path "$k\DefaultIcon" -Force | Out-Null
$icon = if ($pfDir -and (Test-Path "$pfDir\PreFormLauncher.exe")) { "$pfDir\PreFormLauncher.exe,0" } elseif ($built) { "$exe,0" } else { 'powershell.exe,0' }
Set-ItemProperty -Path "$k\DefaultIcon" -Name '(default)' -Value $icon
New-Item -Path "$k\shell\open\command" -Force | Out-Null
# the name the browser shows in its question ("... trying to open NLO Tray Maker", not "Windows Script Host")
Set-ItemProperty -Path "$k\shell\open" -Name 'FriendlyAppName' -Value 'NLO Tray Maker'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$command = if ($built) { '"' + $exe + '" "%1"' }
           elseif (Test-Path $wscript) { '"' + $wscript + '" //B //Nologo "' + $launcher + '" "%1"' }
           else { 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $handler + '" "%1"' }
Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value $command
Note "registered: $command"

# ---------------------------------------------------------------------------------------------------------------
# 3. does Windows start it from a link? (the step that failed silently before)
# ---------------------------------------------------------------------------------------------------------------
function Test-Handler([string]$how) {
  $t = [guid]::NewGuid().ToString('N').Substring(0, 12)
  try {
    if ($how -eq 'link') { Start-Process ('nlobt://selftest?t=' + $t) }
    elseif ($how -eq 'exe') { Start-Process -FilePath $exe -ArgumentList ('nlobt://selftest?t=' + $t) }
    else { Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $handler + '"'), ('nlobt://selftest?t=' + $t)) }
  } catch { Note "self-test ($how) could not start: $($_.Exception.Message)"; return $false }
  $until = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $until) {
    Start-Sleep -Milliseconds 400
    try { if ((Test-Path -LiteralPath $logfile) -and (Select-String -LiteralPath $logfile -SimpleMatch ('selftest ' + $t + ' ok') -Quiet)) { return $true } } catch {}
  }
  $false
}
$works = Test-Handler 'link'
if ($works) { Line $true "Windows starts it from a link (self-test passed)"; Note "self-test passed" }
else {
  $direct = if ($built) { Test-Handler 'exe' } else { Test-Handler 'ps' }
  Note "self-test FAILED (direct run: $direct)"
  if ($direct) {
    Line $false "The handler runs, but Windows did not start it from the link. Run this line again; if it says the same, restart the PC once."
  } elseif ($built) {
    Line $false "This PC stops the handler from running (antivirus or a Windows policy). Ask the IT person to allow: $exe"
  } else {
    $pol = try { (Get-ExecutionPolicy -List | Where-Object { $_.ExecutionPolicy -ne 'Undefined' } | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ', ' } catch { '?' }
    Line $false "This PC stops PowerShell scripts from running (execution policy: $pol). Ask the IT person to allow: $handler"
  }
}

# ---------------------------------------------------------------------------------------------------------------
# 4. the browser's "Open NLO Tray Maker?" question - off for the Tray Maker's address (one admin OK)
# ---------------------------------------------------------------------------------------------------------------
function Merged-Policy([string]$key) {
  # the value with nlobt: from the Tray Maker added; other protocols in it (Teams, Zoom ...) are kept as they are.
  # $null when it already says so (nothing to do), or when the value there cannot be read (left alone)
  $raw = $null
  try { $raw = (Get-ItemProperty -Path $key -Name 'AutoLaunchProtocolsFromOrigins' -ErrorAction Stop).AutoLaunchProtocolsFromOrigins } catch {}
  $cur = @()
  if ($raw) { try { $cur = @($raw | ConvertFrom-Json | ForEach-Object { $_ }) } catch { Note "policy at $key unreadable, left alone: $raw"; return $null } }
  $mine = @($cur | Where-Object { $_ -and $_.protocol -eq 'nlobt' })
  $same = $false      # (Windows PowerShell 5.1's Compare-Object throws on an empty list: an empty entry is just "not the same")
  try { $same = ($mine.Count -eq 1) -and -not (Compare-Object @($mine[0].allowed_origins | Where-Object { $_ }) $origins) } catch { $same = $false }
  if ($same) { return $null }
  $all = @($cur | Where-Object { $_ -and $_.protocol -ne 'nlobt' }) + @([pscustomobject]@{ protocol = 'nlobt'; allowed_origins = @($origins) })
  ConvertTo-Json -InputObject $all -Compress -Depth 6
}
$keys = @('HKLM:\SOFTWARE\Policies\Microsoft\Edge')
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if ($chrome) { $keys += 'HKLM:\SOFTWARE\Policies\Google\Chrome' }
$todo = [ordered]@{}
foreach ($key in $keys) { try { $j = Merged-Policy $key; if ($j) { $todo[$key] = $j } } catch { Note "policy at $key not read: $($_.Exception.Message)" } }
$browsers = ($keys | ForEach-Object { if ($_ -match 'Edge') { 'Edge' } else { 'Chrome' } }) -join ' and '
if ($todo.Count -eq 0) { Line $true "The browser does not ask 'Open NLO Tray Maker?' ($browsers - set before)" }
else {
  $isAdmin = $false
  try { $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}
  try {
    if ($isAdmin) {
      foreach ($key in $todo.Keys) { if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }; New-ItemProperty -Path $key -Name 'AutoLaunchProtocolsFromOrigins' -Value $todo[$key] -PropertyType String -Force | Out-Null }
    } else {
      # one .reg file, imported by regedit with one Windows admin OK (no script runs elevated)
      $reg = "Windows Registry Editor Version 5.00`r`n"
      foreach ($key in $todo.Keys) { $reg += "`r`n[" + ($key -replace '^HKLM:', 'HKEY_LOCAL_MACHINE') + "]`r`n" + '"AutoLaunchProtocolsFromOrigins"="' + $todo[$key].Replace('\', '\\').Replace('"', '\"') + '"' + "`r`n" }
      $regFile = Join-Path $dir 'browser_policy.reg'
      Set-Content -LiteralPath $regFile -Value $reg -Encoding Unicode
      Write-Host "  ...    Windows will ask for permission once, to stop the browser asking 'Open NLO Tray Maker?' on every click - click Yes." -ForegroundColor Yellow
      Start-Process -FilePath (Join-Path $env:WINDIR 'regedit.exe') -Verb RunAs -Wait -ArgumentList @('/s', ('"' + $regFile + '"'))
    }
  } catch { Note "browser policy not set: $($_.Exception.Message)" }
  $left = @($todo.Keys | Where-Object { try { Merged-Policy $_ } catch { $true } })
  if (-not $left) { Line $true "The browser no longer asks 'Open NLO Tray Maker?' ($browsers). Still asks? Open edge://policy and click 'Reload policies', or restart the browser."; Note "browser policy set: $browsers" }
  else { Line $null "The browser will still ask 'Open NLO Tray Maker?' on each click - click Open. (Windows' admin OK was not given; run this line again to retry.)"; Note "browser policy not set (no admin OK)" }
}

# ---------------------------------------------------------------------------------------------------------------
if ($pfDir) { Line $true "PreForm: $pfDir" } else { Line $null "PreForm was not found under Program Files\Formlabs\PreForm on this PC - install it, then the button works" }
Note "done (self-test: $works)"
Write-Host ''
if ($works) { Write-Host "DONE - on a case in the Tray Maker, click 'Open in PreForm on this PC'." -ForegroundColor Green }
else { Write-Host "NOT WORKING YET on this PC - see the [!!] line above. Meanwhile, the Export button's zip (or 'on lab') still works." -ForegroundColor Red }
Write-Host "Log of every click: $logfile"
