# NLO Tray Maker - share this PC's scanner tooth maps with the Tray Maker PC.
#
# Run ONCE on every PC where cases are opened in AS Connect (not needed on the Tray Maker PC itself, harmless there).
# Open PowerShell (Start, type "powershell", Enter), paste this line and press Enter:
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/as_sync_install.ps1' -UseBasicParsing).Content
#
# What it does: sets up a Windows task, under your own login, that every 2 minutes copies the scan and its tooth/gum
# map (4 small files per case, cases from the last 30 days) from this PC's AS Connect folder to
#   <shared drive>\clinical\3D printing\AS Connect maps\<this PC's name>\cases
# AS Connect itself is not touched, nothing is deleted, nothing leaves the office, and no file is written on this PC.
# To remove it again:  Unregister-ScheduledTask -TaskName 'NLO AS Connect maps' -Confirm:$false
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host ' ==============================================='
Write-Host '  NLO Tray Maker - share scanner tooth maps'
Write-Host ' ==============================================='
$src = 'C:\Users\Public\Documents\Alliedstar\Connect\storage\cases'
if (-not (Test-Path $src)) {
  Write-Host " AS Connect's case folder was not found on this PC ($src)." -ForegroundColor Yellow
  Write-Host ' Open one case in AS Connect on this PC first, then run this again.'
  return
}
# the shared clinical drive: whichever drive has clinical\3D printing on it (the letter differs between PCs)
$share = $null
foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
  $p = Join-Path $d.Root 'clinical\3D printing'
  if (Test-Path $p) {
    # use the network name behind a mapped letter, so the task does not depend on the letter being mapped
    $share = if ($d.DisplayRoot -and $d.DisplayRoot.StartsWith('\\')) { Join-Path $d.DisplayRoot 'clinical\3D printing' } else { $p }
    break
  }
}
if (-not $share) {
  Write-Host ' The shared clinical drive was not found on this PC (no drive has clinical\3D printing on it).' -ForegroundColor Yellow
  $share = Read-Host ' Type the path of the "3D printing" folder (e.g. O:\clinical\3D printing)'
  if (-not (Test-Path $share)) { Write-Host ' That folder does not exist. Nothing was set up.' -ForegroundColor Red; return }
}
$dst = Join-Path $share ("AS Connect maps\" + $env:COMPUTERNAME + "\cases")
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Write-Host " From: $src"
Write-Host " To:   $dst"
$copyArgs = '"' + $src + '" "' + $dst + '" upper.a3d lower.a3d upper.vertex_type lower.vertex_type /S /XO /MAXAGE:30 /R:1 /W:1 /NP /NJH /NJS /NFL /NDL'
# conhost --headless keeps the copy from flashing a black window every 2 minutes (Windows 10 1809 and later)
$headless = $false
try { $headless = ([Environment]::OSVersion.Version.Build -ge 17763) -and (Test-Path "$env:WINDIR\System32\conhost.exe") } catch {}
if ($headless) { $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" -Argument ('--headless robocopy.exe ' + $copyArgs) }
else { $action = New-ScheduledTaskAction -Execute 'robocopy.exe' -Argument $copyArgs }
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
try {
  Register-ScheduledTask -TaskName 'NLO AS Connect maps' -Action $action -Trigger $trigger -Settings $settings -Description 'Copies AS Connect scan tooth maps to the shared drive for Tray Maker' -Force | Out-Null
} catch {
  Write-Host " Windows would not create the task on this PC: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ' Nothing was set up. Send this message to Claude.'
  return
}
Write-Host ' Copying what is there now (first time can take a minute)...'
& robocopy.exe $src $dst upper.a3d lower.a3d upper.vertex_type lower.vertex_type /S /XO /MAXAGE:30 /R:1 /W:1 /NP /NJH /NJS /NFL /NDL | Out-Null
$n = @(Get-ChildItem $dst -Recurse -Filter '*.vertex_type' -ErrorAction SilentlyContinue).Count
Write-Host ''
Write-Host " Done. $n tooth-map files from this PC are now on the shared drive." -ForegroundColor Green
Write-Host ' From now on, cases opened in AS Connect on this PC reach Tray Maker within about 2 minutes,'
Write-Host ' as long as someone is logged in on this PC.'
Write-Host ''
