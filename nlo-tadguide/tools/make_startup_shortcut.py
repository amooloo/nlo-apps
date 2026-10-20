"""Used by install.bat: make start_app.bat run at sign-in (same way as Tray Maker).

Primary: a per-user registry Run entry. Secondary: a shortcut in the Startup folder.
"""
import os, sys, subprocess

NAME = "NLO TAD Guide"
target = os.path.abspath(sys.argv[1])  # start_app.bat
ok = False
try:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, NAME, 0, winreg.REG_SZ, f'"{target}" autostart')
    print("autostart: registry Run entry set ->", target)
    ok = True
except Exception as ex:  # noqa
    print("registry autostart failed:", ex)

try:
    if ok:          # one way is enough: two would start two copies at sign-in (the second just exits)
        raise StopIteration
    ps = (
        "$d=[Environment]::GetFolderPath('Startup'); if(-not $d){$d=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'};"
        "New-Item -ItemType Directory -Force -Path $d | Out-Null;"
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d '%s.lnk'));"
        "$s.TargetPath='%s';$s.Arguments='autostart';$s.WorkingDirectory='%s';$s.WindowStyle=7;$s.Save();Write-Output ('shortcut: '+(Join-Path $d '%s.lnk'))"
        % (NAME, target.replace("'", "''"), os.path.dirname(target).replace("'", "''"), NAME)
    )
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    if r.returncode == 0 and "shortcut:" in r.stdout:
        print(r.stdout.strip())
        ok = True
except Exception:
    pass

if not ok:
    print("Could not set autostart. The app can still be started by double-clicking start_app.bat.")
    sys.exit(1)
