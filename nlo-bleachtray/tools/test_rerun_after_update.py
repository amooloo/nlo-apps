"""Apply & re-run with nothing painted re-makes a model that another version of the app made, and only then.

The doctor, 11/12/2026: after the update "it says nothing has painted, nothing to rerun" - the fix could not be put
onto the open case. A model carries the build that made it (`app_build` in its report); a re-run with no edits re-makes
the models whose build is not this one, and answers "nothing" once they are.

    python tools/test_rerun_after_update.py      (the real server on port 8797, the pipeline stubbed)
"""
import os, sys, time, threading, json, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8797
fails = []


def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
    if not ok:
        fails.append(name)


def main():
    import app.server as srv
    import uvicorn
    job, _ = TPP.make_case(srv)
    JID = TPP.JID
    seen = {"n": 0}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["n"] += 1
        sc = next(s for s in job["scans"] if s["name"] == name)
        rep = dict(sc["report"]); rep.pop("app_build", None)
        return rep
    srv.process = fake_process
    threading.Thread(target=lambda: uvicorn.run(srv.app, host="127.0.0.1", port=PORT, log_level="error"), daemon=True).start()
    time.sleep(1.5)

    def rerun():
        data = urllib.parse.urlencode(dict(edits="{}", params="{}")).encode()
        return json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}/api/jobs/{JID}/rerun", data=data), timeout=20))

    def wait_done():
        t0 = time.time()
        while time.time() - t0 < 60:
            j = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/jobs/{JID}", timeout=20))
            if j.get("status") in ("done", "error"):
                return j
            time.sleep(0.3)
        return {}

    n_sc = len(job["scans"])
    check("the case's models carry no build yet (made before this version)", all("app_build" not in (s.get("report") or {}) for s in job["scans"]))
    r = rerun()
    check("Apply & re-run with nothing painted starts a run for them", not r.get("nothing"), r)
    j = wait_done()
    check("... every model is made again", seen["n"] == n_sc and j.get("status") == "done", (seen["n"], n_sc, j.get("status")))
    check("... and carries this build now", all((s.get("report") or {}).get("app_build") == srv.BUILD["build"] for s in job["scans"]), [(s.get("report") or {}).get("app_build") for s in job["scans"]])
    r = rerun()
    check("a second Apply with nothing painted has nothing to do", r.get("nothing") is True and seen["n"] == n_sc, (r, seen["n"]))
    srv.BUILD["build"] = "another-build"
    r = rerun()
    check("after an update (another build) it runs again", not r.get("nothing"), r)
    wait_done()
    check("... once for each model", seen["n"] == 2 * n_sc, seen["n"])
    print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
