<#
  NLO Titan Launcher  -  lets NLO Cases open the Titan desktop app on this computer.

  A web page can't start a program on its own. What it can do is open a link of a kind Windows knows: this script teaches this
  computer the kind "nlo-titan:" and answers it. "Open Titan (app)" on an in-house case in NLO Cases opens
      nlo-titan:open?name=<the patient's name>
  Windows hands that to this script, which puts the patient's name on the clipboard (paste it in Titan's search, like the web
  portals) and brings Titan to the front - starting it if it isn't running. Nothing else: the link never runs anything, and the
  only thing read from it is the name (and a chart number, for the log).

  Set up once per computer, as the Windows user who uses NLO Cases there (no administrator needed, about a minute). NLO Cases
  (Team & security -> Titan app, or the hint under the button) shows the one line to paste into Windows PowerShell: it fetches
  this script from the site into %TEMP% and runs it with -Install. By hand, with a downloaded copy:
      right-click the file -> Run with PowerShell   (double-clicking only opens it as text)
      or   powershell -NoProfile -ExecutionPolicy Bypass -File "<where it is>\nlo-titan-launcher.ps1" -Install
  It finds Titan (asks if it can't), keeps a copy of itself in %LOCALAPPDATA%\NLO Titan Launcher, registers "nlo-titan:" for this
  Windows user, and tries it. The first time Chrome or Edge opens one of these links it asks "Open Windows PowerShell?" -
  tick "Always allow" and Open. (The link runs through PowerShell, so that is the name the browser shows.)

  Other switches:  -Install -Titan "C:\...\Titan.exe"   use that program instead of looking for it
                   -Test        the same as the "Test on this computer" button in NLO Cases
                   -Uninstall   forgets "nlo-titan:" on this computer and removes the copy
  Runs on the Windows PowerShell 5.1 that comes with Windows; nothing to install. Log: %LOCALAPPDATA%\NLO Titan Launcher\launcher.log
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Url = '',
  [switch]$Install, [switch]$Uninstall, [switch]$Test,
  [string]$Titan = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$VER = '1.1'
$SCHEME = 'nlo-titan'
$DIR = Join-Path $env:LOCALAPPDATA 'NLO Titan Launcher'
$CFG = Join-Path $DIR 'config.json'
$LOG = Join-Path $DIR 'launcher.log'
$ME = $MyInvocation.MyCommand.Path

function Log([string]$s) {
  try { if (-not (Test-Path $DIR)) { New-Item -ItemType Directory -Path $DIR | Out-Null }
    Add-Content -Path $LOG -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $s)
    if ((Get-Item $LOG).Length -gt 200KB) { $t = Get-Content $LOG -Tail 300; Set-Content -Path $LOG -Value $t }
  } catch { }
}
function Say([string]$s) { Write-Host $s; Log $s }

# ---------- finding Titan on this computer ----------
function Find-Titan {
  $c = New-Object System.Collections.ArrayList
  $add = { param($p) if ($p) { $p = ($p -replace ',-?\d+$', '').Trim('"').Trim(); if ($p -match '\.exe$' -and (Test-Path -LiteralPath $p)) { [void]$c.Add((Resolve-Path -LiteralPath $p).Path) } } }
  # the installed-programs list (this user's and the computer's)
  foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
    try { Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { ($_.PSObject.Properties['DisplayName']) -and $_.DisplayName -match 'Titan' -and $_.DisplayName -notmatch 'Titanium|Titan Tech|TitanTV' } | ForEach-Object {
        if ($_.PSObject.Properties['DisplayIcon']) { & $add $_.DisplayIcon }
        if ($_.PSObject.Properties['InstallLocation'] -and $_.InstallLocation -and (Test-Path -LiteralPath $_.InstallLocation)) {
          Get-ChildItem -LiteralPath $_.InstallLocation -Filter '*.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { & $add $_.FullName } }
      } } catch { }
  }
  # shortcuts in the Start menu and on the desktop
  try { $ws = New-Object -ComObject WScript.Shell
    foreach ($d in (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'), (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'), [Environment]::GetFolderPath('Desktop'), (Join-Path $env:PUBLIC 'Desktop')) {
      Get-ChildItem -LiteralPath $d -Filter '*Titan*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { try { & $add $ws.CreateShortcut($_.FullName).TargetPath } catch { } } }
  } catch { }
  # the usual program folders
  foreach ($d in (Join-Path $env:LOCALAPPDATA 'Programs'), $env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}) {
    if ($d -and (Test-Path -LiteralPath $d)) { Get-ChildItem -LiteralPath $d -Directory -Filter '*Titan*' -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Filter '*.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { & $add $_.FullName } } }
  }
  @($c | Where-Object { $_ -notmatch '(?i)unins|setup|install|updat|crash|report|helper|service|bugsplat|sentry|node\.exe|java' } | Select-Object -Unique)
}

# ---------- the link's parts: nlo-titan:open?name=...&chart=... ----------
function Parse-Link([string]$u) {
  $r = @{ action = ''; name = ''; chart = '' }
  if ($u -notmatch ('^' + $SCHEME + ':/*([^?]*)\??(.*)$')) { return $r }
  $r.action = $Matches[1].Trim('/').ToLower(); $q = $Matches[2]
  foreach ($kv in ($q -split '&')) { if (-not $kv) { continue }
    $p = $kv -split '=', 2; $k = [uri]::UnescapeDataString($p[0]); $v = ''
    if ($p.Count -gt 1) { $v = [uri]::UnescapeDataString(($p[1] -replace '\+', ' ')) }
    if ($k -eq 'name' -or $k -eq 'chart') { $r[$k] = ($v -replace '[\x00-\x1f]', ' ').Trim(); if ($r[$k].Length -gt 120) { $r[$k] = $r[$k].Substring(0, 120) } }
  }
  $r
}

# ---------- bringing Titan to the front ----------
function Show-Titan([string]$exe) {
  $name = [IO.Path]::GetFileNameWithoutExtension($exe)
  $p = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  if (-not $p.Count) { $p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 } catch { $false } }) }
  if ($p.Count) {
    try {
      if (-not ('Nlo.NloWin' -as [type])) { Add-Type -Name NloWin -Namespace Nlo -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' }
      $h = $p[0].MainWindowHandle
      if ([Nlo.NloWin]::IsIconic($h)) { [void][Nlo.NloWin]::ShowWindow($h, 9) }   # restore a minimised window
      [void][Nlo.NloWin]::SetForegroundWindow($h)
    } catch { }
    try { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($p[0].Id) } catch { }
    return 'focused'
  }
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
  'started'
}

function Read-Config { if (-not (Test-Path $CFG)) { throw ('Not set up on this computer yet (no ' + $CFG + '). Run the script with -Install.') }; Get-Content -LiteralPath $CFG -Raw | ConvertFrom-Json }

function Handle-Link([string]$u) {
  $l = Parse-Link $u
  $chart = ''; if ($l.chart) { $chart = ' chart ' + $l.chart }
  Log ('link: ' + $l.action + $chart)
  if ($l.action -eq 'test') {
    Add-Type -AssemblyName System.Windows.Forms
    $cfg = $null; try { $cfg = Read-Config } catch { }
    $where = 'But Titan is not set up here - run the launcher with -Install.'; if ($cfg) { $where = 'Titan: ' + $cfg.titan }
    $msg = 'NLO Cases can open Titan on this computer.' + "`r`n`r`n" + $where + "`r`n" + 'Launcher ' + $VER + ' in ' + $DIR
    [void][System.Windows.Forms.MessageBox]::Show($msg, 'NLO Titan Launcher', 'OK', 'Information')
    return
  }
  $cfg = Read-Config
  if ($l.name) { try { Set-Clipboard -Value $l.name } catch { try { $l.name | clip.exe } catch { } } }
  $how = Show-Titan $cfg.titan
  $copied = ''; if ($l.name) { $copied = ', name copied' }
  Log ('Titan ' + $how + $copied)
}

# ---------- setup ----------
function Install-Launcher {
  Say ('NLO Titan Launcher ' + $VER + ' - setting up for ' + $env:USERNAME + ' on ' + $env:COMPUTERNAME)
  if ($env:OS -ne 'Windows_NT') { throw 'This sets up a Windows computer.' }
  $exe = $Titan
  if ($exe -and -not (Test-Path -LiteralPath $exe)) { throw ('Not found: ' + $exe) }
  if (-not $exe) {
    $found = Find-Titan
    if ($found.Count -eq 1) { $exe = $found[0]; Say ('Found Titan: ' + $exe) }
    elseif ($found.Count -gt 1) {
      Write-Host 'More than one program looks like Titan:'; for ($i = 0; $i -lt $found.Count; $i++) { Write-Host ('  ' + ($i + 1) + '. ' + $found[$i]) }
      $n = Read-Host 'Which one is Titan? (number)'; $exe = $found[[int]$n - 1]
    } else {
      Write-Host 'Titan was not found in the usual places. If it is installed, pick its program (Titan.exe) in the window that opens.'
      Add-Type -AssemblyName System.Windows.Forms
      $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Where is Titan? (its .exe)'; $d.Filter = 'Programs (*.exe)|*.exe'; $d.InitialDirectory = $env:LOCALAPPDATA
      if ($d.ShowDialog() -ne 'OK') { throw 'No program picked - nothing set up. Install Titan on this computer first, or run again with -Titan "C:\...\Titan.exe".' }
      $exe = $d.FileName
    }
  }
  if (-not (Test-Path $DIR)) { New-Item -ItemType Directory -Path $DIR | Out-Null }
  $copy = Join-Path $DIR 'nlo-titan-launcher.ps1'
  if ((Resolve-Path -LiteralPath $ME).Path -ne $copy) { Copy-Item -LiteralPath $ME -Destination $copy -Force }
  try { Unblock-File -LiteralPath $copy } catch { }   # (a download carries the "from the internet" mark; the copy needn't)
  @{ titan = $exe; ver = $VER; at = (Get-Date).ToString('s'); user = $env:USERNAME } | ConvertTo-Json | Set-Content -LiteralPath $CFG -Encoding UTF8
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $cmd = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $copy + '" "%1"'
  $k = 'HKCU:\Software\Classes\' + $SCHEME
  if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
  Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:NLO Titan (opens the Titan app from NLO Cases)'
  Set-ItemProperty -Path $k -Name 'URL Protocol' -Value ''
  New-Item -Path ($k + '\DefaultIcon') -Force | Out-Null; Set-ItemProperty -Path ($k + '\DefaultIcon') -Name '(default)' -Value ('"' + $exe + '",0')
  New-Item -Path ($k + '\shell\open\command') -Force | Out-Null; Set-ItemProperty -Path ($k + '\shell\open\command') -Name '(default)' -Value $cmd
  Say ('Registered ' + $SCHEME + ': for this Windows user -> ' + $copy)
  Say ('Titan: ' + $exe)
  Say 'Trying it (a small "NLO Titan Launcher" box should appear)...'
  try { Start-Process ($SCHEME + ':test') } catch { Say ('Could not try the link: ' + $_.Exception.Message) }
  Say 'Done. In NLO Cases, open an in-house case and tap "Open Titan (app)". The first time, the browser asks "Open Windows PowerShell?" - tick "Always allow" and Open.'
  Hold-Window
}
# when run by right-click -> Run with PowerShell (or a double-clicked line), the window would close at once: keep it until Enter
function Hold-Window { try { if ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected) { Write-Host ''; [void](Read-Host 'Press Enter to close this window') } } catch { } }

function Uninstall-Launcher {
  $k = 'HKCU:\Software\Classes\' + $SCHEME
  if (Test-Path $k) { Remove-Item -Path $k -Recurse -Force; Say ('Forgot ' + $SCHEME + ': for this Windows user') } else { Say 'Was not set up for this Windows user' }
  if (Test-Path $DIR) { Remove-Item -Path $DIR -Recurse -Force; Say ('Removed ' + $DIR) }
}

try {
  if ($Uninstall) { Uninstall-Launcher }
  elseif ($Test) { Handle-Link ($SCHEME + ':test') }
  elseif ($Url -match ('^' + $SCHEME + ':')) { Handle-Link $Url }
  elseif ($Install -or -not $Url) { Install-Launcher }
  else { throw ('Not an ' + $SCHEME + ': link: ' + $Url) }
} catch {
  Log ('ERROR ' + $_.Exception.Message)
  if ($Url -match ('^' + $SCHEME + ':')) {
    try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(('Could not open Titan: ' + $_.Exception.Message + "`r`n`r`n" + 'Set it up again from NLO Cases (Team & security -> Titan app).'), 'NLO Titan Launcher', 'OK', 'Warning') } catch { }
  } else { Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red; Hold-Window; exit 1 }
}
