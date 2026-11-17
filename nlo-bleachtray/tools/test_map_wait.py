"""Waiting for the scanner's tooth map of a scan exported a moment ago (gumline.scanner_tooth_mask / map_wait_deadline).

    python tools/test_map_wait.py

The other PCs copy their AS Connect maps to the shared drive every 2 minutes; a scan uploaded sooner than that used to
be made without its map (the doctor, 11/17/2026). No scan is needed: a small synthetic .a3d / .vertex_type pair."""
import os, sys, time, tempfile
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from bleachtray import gumline as g

FAILS = []


def check(what, ok, got=None):
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f"   -> {got!r}"))
    if not ok:
        FAILS.append(what)


def write_case(cases, case_id, V, tooth, arch="upper"):
    """A stored AS Connect scan as read_a3d / read_vertex_type expect it."""
    d = os.path.join(cases, case_id, "model"); os.makedirs(d, exist_ok=True)
    nv = len(V); F = np.array([[0, 1, 2]], np.uint32)
    head = np.zeros(8, np.uint32); head[2], head[3] = nv, len(F)
    with open(os.path.join(d, arch + ".a3d"), "wb") as f:
        f.write(head.tobytes() + V.astype(np.float32).tobytes() + np.zeros((nv, 3), np.float32).tobytes() + F.tobytes())
    vh = np.zeros(6, np.uint32); vh[5] = nv
    with open(os.path.join(d, arch + ".vertex_type"), "wb") as f:
        f.write(vh.tobytes() + np.where(tooth, 2.0, 1.0).astype(np.float32).tobytes())


def stamp(t):
    return time.strftime("%Y%m%d_%H-%M-%S", time.localtime(t))


def main():
    rng = np.random.default_rng(0)
    V = rng.uniform(-20, 20, (6000, 3)); tooth = V[:, 2] > 0
    other = rng.uniform(-20, 20, (6000, 3)) + 100.0
    now = time.time()

    print("map_wait_deadline")
    d = g.map_wait_deadline(f"Chetley_Breeden_{stamp(now - 32)}_upper_P1", now=now)
    check("a scan exported 32 s ago waits until the next copy has had time", d is not None and 100 < d - now <= 150, d and d - now)
    check("a scan exported ten minutes ago does not wait", g.map_wait_deadline(f"A_B_{stamp(now - 600)}_upper", now=now) is None)
    check("a scan with no AS Connect time in its name does not wait", g.map_wait_deadline("Smith_John_upper_TT", now=now) is None)
    check("a clock far ahead does not make it wait", g.map_wait_deadline(f"A_B_{stamp(now + 3600)}_upper", now=now) is None)
    os.environ["NLO_MAP_WAIT"] = "0"
    check("NLO_MAP_WAIT=0 switches the wait off", g.map_wait_deadline(f"A_B_{stamp(now - 5)}_upper", now=now) is None)
    del os.environ["NLO_MAP_WAIT"]

    with tempfile.TemporaryDirectory() as tmp:
        own = os.path.join(tmp, "own"); os.makedirs(own)
        share = os.path.join(tmp, "AS Connect maps"); cases = os.path.join(share, "DRA", "cases"); os.makedirs(cases)
        g.AS_STORAGE = own
        os.environ["NLO_AS_MAPS"] = share
        write_case(cases, "someone-else", other, other[:, 2] > 100)

        print("the map arrives while the scan waits")
        clock = [1000.0]; logs = []
        def sleep(s):
            clock[0] += s
            if clock[0] >= 1040.0 and not os.path.isdir(os.path.join(cases, "this-case")):
                write_case(cases, "this-case", V, tooth)            # the other PC's copy lands 40 s in
        m = g.scanner_tooth_mask(V, storage=own, log=logs.append, wait_until=1150.0, _sleep=sleep, _now=lambda: clock[0])
        check("the map is found once it arrives", m is not None and bool((m == tooth).all()), None if m is None else int((m != tooth).sum()))
        check("it did not wait the whole time", clock[0] < 1060.0, clock[0])
        check("the log says it waited and that the map arrived", any("waiting up to 150 s" in l for l in logs) and any("arrived after" in l for l in logs), logs)

        print("the map never arrives")
        clock = [1000.0]; logs = []
        m = g.scanner_tooth_mask(other + 500.0, storage=own, log=logs.append, wait_until=1150.0, _sleep=lambda s: clock.__setitem__(0, clock[0] + s), _now=lambda: clock[0])
        check("no map: None after the deadline, not before", m is None and 1150.0 <= clock[0] < 1160.0, (m is None, clock[0]))
        check("the log says no map was found and where it looked", any("no scanner map for this scan after waiting 150 s" in l and "1 other PC" in l for l in logs), logs)

        print("no wait when it is not asked for, or the map is already there")
        clock = [1000.0]; logs = []
        m = g.scanner_tooth_mask(other + 500.0, storage=own, log=logs.append, _sleep=lambda s: clock.__setitem__(0, clock[0] + s), _now=lambda: clock[0])
        check("an older export does not wait", m is None and clock[0] == 1000.0 and any("no scanner map" in l for l in logs), (clock[0], logs))
        clock = [1000.0]; logs = []
        m = g.scanner_tooth_mask(V, storage=own, log=logs.append, wait_until=1150.0, _sleep=lambda s: clock.__setitem__(0, clock[0] + s), _now=lambda: clock[0])
        check("a map already on the shared drive is used at once", m is not None and clock[0] == 1000.0 and any("map found" in l for l in logs), (clock[0], logs))

        print("no other PC shares its maps")
        os.environ["NLO_AS_MAPS"] = os.path.join(tmp, "nothing-here")
        clock = [1000.0]; logs = []
        m = g.scanner_tooth_mask(V, storage=own, log=logs.append, wait_until=1150.0, _sleep=lambda s: clock.__setitem__(0, clock[0] + s), _now=lambda: clock[0])
        check("nothing to wait for: no wait", m is None and clock[0] == 1000.0, clock[0])

        print("the share by its network name")
        del os.environ["NLO_AS_MAPS"]
        g.EXTRA_MAP_ROOTS[:] = [share, share]
        check("found through EXTRA_MAP_ROOTS, once", g.shared_map_folders() == [cases], g.shared_map_folders())
        g.EXTRA_MAP_ROOTS[:] = []

    print("\n" + ("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
