"""Used by install.bat: make start_watch.bat run at sign-in.

Primary: a per-user registry Run entry (works on every Windows PC, no Startup folder needed).
Secondary: a shortcut in the Startup folder, created if the folder exists or can be created.
"""
import os, sys, subprocess

target = os.path.abspath(sys.argv[1])  # start_app.bat (serves the app + watches the folder)
ok = False
try:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "NLO Bleach Tray", 0, winreg.REG_SZ, f'"{target}" autostart')
    print("autostart: registry Run entry set ->", target)
    ok = True
except Exception as ex:  # noqa
    print("registry autostart failed:", ex)

try:
    ps = (
        "$d=[Environment]::GetFolderPath('Startup'); if(-not $d){$d=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'};"
        "New-Item -ItemType Directory -Force -Path $d | Out-Null;"
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'NLO Bleach Tray.lnk'));"
        "$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.WindowStyle=7;$s.Save();Write-Output ('shortcut: '+(Join-Path $d 'NLO Bleach Tray.lnk'))"
        % (target.replace("'", "''"), os.path.dirname(target).replace("'", "''"))
    )
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    if r.returncode == 0 and "shortcut:" in r.stdout:
        print(r.stdout.strip())
        ok = True
except Exception:
    pass

if not ok:
    print("Could not set autostart. The watcher can still be started by double-clicking start_watch.bat.")
    sys.exit(1)
