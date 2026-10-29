// NLO Tray Maker - the nlobt: link handler: opens the Tray Maker's models in PreForm on THIS PC.
//
// Built on each PC by preform_link.ps1 with the C# compiler that comes with Windows (.NET Framework 4), so nothing
// is downloaded as a program. It replaces the PowerShell handler (and its wscript launcher): on the doctor's PC the
// browser's "Open" ran neither - Windows stopped the script before it wrote a line (10/29/2026: "when I click open,
// nothing happens") - and staff were asked to open "Microsoft Windows Script Host", which reads like malware.
//
//   nlobt://preform?f=<path>&f=<path>&wait=<s>&t=<token>&cb=<app address>
//       waits for the model files on the office share (the app writes them right after the click), then starts
//       PreForm with them; tells the app how it went (cb + /api/preform/ack), so the page says what happened
//   nlobt://selftest?t=<token>
//       only writes "selftest <token> ok" to the log: the setup's check that Windows starts this from a link
//
// Every run is written to preform_open.log next to this program; anything that stops it is said in a message box
// on top of every window - never silently. C# 5 only (the compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("NLO Tray Maker")]
[assembly: AssemblyProduct("NLO Tray Maker")]
[assembly: AssemblyDescription("Opens the Tray Maker's models in PreForm on this PC")]
[assembly: AssemblyCompany("Next Level Orthodontics")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

public static class NloBt
{
    public const string HandlerVersion = "2.0";
    static string _dir;
    static string Cb, Token;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
    const uint MB_ICONWARNING = 0x30, MB_ICONINFO = 0x40, MB_SETFOREGROUND = 0x10000, MB_TOPMOST = 0x40000;

    public static string Dir
    {
        get
        {
            if (_dir == null)
            {
                try { _dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); } catch { }
                if (string.IsNullOrEmpty(_dir)) _dir = AppDomain.CurrentDomain.BaseDirectory;
            }
            return _dir;
        }
        set { _dir = value; }
    }
    public static string LogPath { get { return Path.Combine(Dir, "preform_open.log"); } }

    public static void Log(string m)
    {
        try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + m + Environment.NewLine); } catch { }
    }

    static void Say(string m, uint icon)
    {
        Log("SAID: " + m.Replace("\r", "").Replace("\n", " | "));
        try { MessageBoxW(IntPtr.Zero, m + "\n\nLog: " + LogPath, "NLO Tray Maker - PreForm", icon | MB_SETFOREGROUND | MB_TOPMOST); } catch { }
    }

    // what stopped it: the page first (it is waiting for word), then the box on screen
    static int Fail(string m)
    {
        Ack("error", m, 0);
        Say(m, MB_ICONWARNING);
        return 1;
    }

    // tells the Tray Maker page how it went; a page that is not listening (or an older app) costs a short wait at most
    static void Ack(string status, string msg, int n)
    {
        if (string.IsNullOrEmpty(Cb) || string.IsNullOrEmpty(Token)) return;
        try
        {
            string m = msg ?? "";
            if (m.Length > 400) m = m.Substring(0, 400) + "...";
            string url = Cb.TrimEnd('/') + "/api/preform/ack?t=" + Uri.EscapeDataString(Token) + "&s=" + status
                + "&pc=" + Uri.EscapeDataString(Environment.MachineName) + "&n=" + n + "&v=" + HandlerVersion
                + "&msg=" + Uri.EscapeDataString(m);
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(url);
            rq.Timeout = 4000; rq.ReadWriteTimeout = 4000;
            rq.Proxy = null;                          // the app is on the office network: no proxy, no proxy detection wait
            using (WebResponse rs = rq.GetResponse()) { }
        }
        catch (Exception ex) { Log("could not tell the page (" + status + "): " + ex.Message); }
    }

    // nlobt://preform?... -> "preform"; nlobt:selftest -> "selftest"
    public static string WhatOf(string url)
    {
        string s = url ?? "";
        int c = s.IndexOf(':');
        if (c >= 0) s = s.Substring(c + 1);
        s = s.TrimStart('/');
        int e = s.IndexOfAny(new char[] { '?', '/', '#' });
        if (e >= 0) s = s.Substring(0, e);
        return s.ToLowerInvariant();
    }

    // the query by hand: f=<url-encoded path>, repeated; a trailing slash (Windows adds one now and then) is dropped
    public static Dictionary<string, List<string>> Query(string url)
    {
        Dictionary<string, List<string>> q = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        string s = url ?? "";
        int i = s.IndexOf('?');
        s = i >= 0 ? s.Substring(i + 1) : "";
        int h = s.IndexOf('#');
        if (h >= 0) s = s.Substring(0, h);
        s = s.TrimEnd('/');
        foreach (string part in s.Split('&'))
        {
            if (part.Length == 0) continue;
            int e = part.IndexOf('=');
            string k = Unescape(e >= 0 ? part.Substring(0, e) : part);
            string v = e >= 0 ? Unescape(part.Substring(e + 1)) : "";
            List<string> l;
            if (!q.TryGetValue(k, out l)) { l = new List<string>(); q[k] = l; }
            l.Add(v);
        }
        return q;
    }

    static string Unescape(string s)
    {
        try { return Uri.UnescapeDataString(s.Replace('+', ' ')); } catch { return s; }
    }

    public static string One(Dictionary<string, List<string>> q, string k)
    {
        List<string> l;
        return q.TryGetValue(k, out l) && l.Count > 0 ? l[0] : null;
    }

    public static System.Version VersionOf(string folderName)
    {
        StringBuilder sb = new StringBuilder();
        foreach (char ch in folderName ?? "") if (char.IsDigit(ch) || ch == '.') sb.Append(ch);
        string[] parts = sb.ToString().Split(new char[] { '.' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return null;
        string t = parts.Length == 1 ? parts[0] + ".0" : string.Join(".", parts, 0, Math.Min(4, parts.Length));
        System.Version v;
        return System.Version.TryParse(t, out v) ? v : null;
    }

    // PreForm on this PC: PreForm.exe beside the launcher (older installs), the newest versioned subfolder's
    // PreForm.exe (PreForm 3.6x: ...\PreForm\3.64.1.664\), the launcher itself, then the registry's App Paths entry.
    // The same order as the app's own search on the lab PC.
    public static string FindPreForm(IEnumerable<string> bases)
    {
        foreach (string b in bases)
        {
            if (string.IsNullOrEmpty(b)) continue;
            string f = Path.Combine(Path.Combine(b, "Formlabs"), "PreForm");
            if (!Directory.Exists(f)) continue;
            string direct = Path.Combine(f, "PreForm.exe");
            if (File.Exists(direct)) return direct;
            string best = null; System.Version bestV = null;
            foreach (string d in Directory.GetDirectories(f))
            {
                string exe = Path.Combine(d, "PreForm.exe");
                if (!File.Exists(exe)) continue;
                System.Version v = VersionOf(Path.GetFileName(d));
                if (best == null || (v != null && (bestV == null || v > bestV))) { best = exe; bestV = v; }
            }
            if (best != null) return best;
            string launcher = Path.Combine(f, "PreFormLauncher.exe");
            if (File.Exists(launcher)) return launcher;
        }
        return null;
    }

    static string FindPreForm()
    {
        List<string> bases = new List<string>();
        foreach (string b in new string[] {
            Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramW6432"),
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") })
            if (!string.IsNullOrEmpty(b) && !bases.Contains(b)) bases.Add(b);
        string found = FindPreForm(bases);
        if (found != null) return found;
        foreach (RegistryKey hive in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            try
            {
                using (RegistryKey k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe"))
                {
                    string p = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(p)) { p = p.Trim('"'); if (File.Exists(p)) return p; }
                }
            }
            catch { }
        }
        return null;
    }

    public static List<string> WantedFiles(Dictionary<string, List<string>> q)
    {
        List<string> want = new List<string>();
        List<string> fl;
        if (q.TryGetValue("f", out fl))
            foreach (string f in fl)
                if (!string.IsNullOrEmpty(f) && f.EndsWith(".stl", StringComparison.OrdinalIgnoreCase) && !want.Contains(f)) want.Add(f);
        return want;
    }

    public static int WaitSeconds(Dictionary<string, List<string>> q)
    {
        int w;
        if (!int.TryParse(One(q, "wait") ?? "", out w)) w = 45;
        return Math.Max(5, Math.Min(180, w));
    }

    // the app's own address only: http(s), nothing else is ever called
    public static string CallbackOf(Dictionary<string, List<string>> q)
    {
        string cb = One(q, "cb");
        if (cb == null) return null;
        Uri u;
        if (!Uri.TryCreate(cb, UriKind.Absolute, out u)) return null;
        if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return null;
        return u.GetLeftPart(UriPartial.Authority);
    }

    static string Quoted(List<string> files)
    {
        StringBuilder sb = new StringBuilder();
        foreach (string f in files) { if (sb.Length > 0) sb.Append(' '); sb.Append('"').Append(f).Append('"'); }
        return sb.ToString();
    }

    [STAThread]
    public static int Main(string[] args)
    {
        string url = string.Join(" ", args).Trim().Trim('"');
        try
        {
            Log("link: " + url + "   (handler " + HandlerVersion + ")");
            Dictionary<string, List<string>> q = Query(url);
            Token = One(q, "t");
            Cb = CallbackOf(q);
            string what = WhatOf(url);
            if (what == "selftest") { Log("selftest " + (Token ?? "") + " ok"); return 0; }
            if (what != "preform") return Fail("This link is not one the Tray Maker sends:\n" + url);
            Ack("started", "", 0);

            List<string> want = WantedFiles(q);
            Log("files asked for: " + string.Join(" ; ", want.ToArray()));
            if (want.Count == 0) return Fail("The link named no model file (.stl):\n" + url);
            string exe = FindPreForm();
            Log("PreForm: " + (exe ?? "NOT FOUND"));
            if (exe == null) return Fail("PreForm is not installed on this PC (looked in Program Files\\Formlabs\\PreForm). Install PreForm here, or use the button's \"on lab\" half to open it on the lab PC.");

            // the app writes the files right after the click: wait for them (a share can take a moment to show a new file)
            int wait = WaitSeconds(q);
            DateTime deadline = DateTime.Now.AddSeconds(wait);
            List<string> have, missing;
            while (true)
            {
                have = want.FindAll(File.Exists);
                missing = want.FindAll(f => !File.Exists(f));
                if (missing.Count == 0 || DateTime.Now > deadline) break;
                Thread.Sleep(700);
            }
            // a file still being copied: wait until its size holds still
            foreach (string f in have)
            {
                long last = -1;
                for (int i = 0; i < 40; i++)
                {
                    long n;
                    try { n = new FileInfo(f).Length; } catch { n = -2; }
                    if (n > 0 && n == last) break;
                    last = n;
                    Thread.Sleep(400);
                }
            }
            Log("found: " + string.Join(" ; ", have.ToArray()) + "   missing: " + string.Join(" ; ", missing.ToArray()));
            if (have.Count == 0)
            {
                bool drive = missing.Exists(f => f.Length > 1 && f[1] == ':');
                return Fail("No model file to open - not reachable from this PC after waiting " + wait + " s:\n" + string.Join("\n", missing.ToArray()) +
                    (drive ? "\n\nThese are drive-letter paths of the lab PC, not share paths (\\\\server\\...). On the lab PC, Settings -> Print folder: type the folder as \\\\server\\share\\... so every PC can reach it."
                           : "\n\nThis PC cannot see them on the office share: open that folder in File Explorer once to check it is reachable from here."));
            }

            string argline = Quoted(have);
            Log("starting: " + exe + " " + argline);
            ProcessStartInfo psi = new ProcessStartInfo(exe, argline);
            psi.UseShellExecute = true;                        // as File Explorer starts a program
            psi.WorkingDirectory = Path.GetDirectoryName(have[0]);   // as on the lab PC: a model saved from PreForm lands next to them
            try { Process.Start(psi); }
            catch (Exception ex)
            {
                Log("start in the models' folder failed (" + ex.Message + ") - again from PreForm's own folder");
                psi.WorkingDirectory = Path.GetDirectoryName(exe);
                Process.Start(psi);
            }
            Log("started");
            Ack("opened", missing.Count > 0 ? missing.Count + " not reachable" : "", have.Count);
            if (missing.Count > 0)
                Say("PreForm opened " + have.Count + " model(s); " + missing.Count + " not reachable from this PC:\n" + string.Join("\n", missing.ToArray()), MB_ICONINFO);
            return 0;
        }
        catch (Exception ex)
        {
            return Fail("Could not open PreForm: " + ex.Message);
        }
    }
}
