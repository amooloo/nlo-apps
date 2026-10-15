"""Used by install.bat: put a shortcut to start_watch.bat in the Windows Startup folder (minimised)."""
import os, sys, subprocess

target = os.path.abspath(sys.argv[1])
startup = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
lnk = os.path.join(startup, "NLO Bleach Tray.lnk")
ps = (
    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
    "$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.WindowStyle=7;$s.Save()"
    % (lnk.replace("'", "''"), target.replace("'", "''"), os.path.dirname(target).replace("'", "''"))
)
subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False)
print("shortcut:", lnk)
