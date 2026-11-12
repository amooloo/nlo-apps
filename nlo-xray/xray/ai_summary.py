"""The AI write-up of one tracing (Amir, 12 Nov 2026: "add an AI to the x-ray app that would read all the data and
summarize it").

The one thing in this app that goes out to the internet, and only when someone clicks *Write AI summary*: the
NUMBERS of the open tracing - the measurements with their norms, the summary's calls, the CVM reading, the age in
years and the sex - go from this PC to the office's AISA Worker (POST /ceph-summary -> Gemini), which sends back a
paragraph for the chart, the findings that stand out and what to check. Never the patient's name, the chart number,
the birth date, the x-ray date, the notes, the x-ray itself or the tracing's points: `build_payload` is the whole
of what is sent, built field by field from what the app itself worked out (no free text anyone typed), and the page
shows it before it goes. The Worker keeps nothing (it logs counts only).

The page never talks to AISA: its Content-Security-Policy still lets the browser reach this PC only. This PC makes
the call.
"""
import datetime as dt
import hashlib
import json
import re
import urllib.error
import urllib.request

AISA_URL = "https://aisa-worker.akhavan-ak.workers.dev/ceph-summary"
TIMEOUT = 75
# the measurements worth showing as "then -> now" against the patient's earlier x-ray
CHANGE_KEYS = ("SNA", "SNB", "ANB", "Wits", "FMA", "SN_GoGn", "LAFH", "U1_SN", "IMPA", "Interincisal", "E_Ls", "E_Li",
               "len_GoMe", "len_NMe")


class AiError(Exception):
    """Something to tell the person at the screen, in plain words."""


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2) if f == f and abs(f) < 1e6 else None


def _months(earlier, later):
    try:
        a, b = dt.date.fromisoformat(earlier), dt.date.fromisoformat(later)
    except (TypeError, ValueError):
        return None
    return max(0, round((b - a).days / 30.44)) if b >= a else None


def _call(analysis, key):
    return next((s.get("call") for s in (analysis.get("summary") or []) if s.get("key") == key), None)


def build_payload(case, analysis, vertebrae_unchecked=0, earlier=None):
    """Everything that is sent - and nothing else. `earlier` = (case, analysis) of the same patient's x-ray before
    this one, when there is one: its numbers go as "before", with the months between (no dates)."""
    a = analysis or {}
    sex = (case.get("patient") or {}).get("sex")
    skipped = set(case.get("skipped") or [])
    rows = []
    for m in a.get("measurements") or []:
        v = _num(m.get("value"))
        if v is None:
            continue
        n = m.get("norm") or {}
        rows.append(dict(name=str(m.get("label") or m.get("key")), group=str(m.get("group") or ""), value=v,
                         unit=str(m.get("unit") or ""),
                         norm=f"{n['mean']:g} ± {n['sd']:g}" if n.get("mean") is not None and n.get("sd") is not None else "",
                         sd_off=_num(m.get("z"))))
    calls = [dict(title=str(s.get("title") or ""), call=str(s.get("call") or ""), detail=str(s.get("detail") or ""))
             for s in a.get("summary") or [] if not (s.get("key") == "cvm" and "cvm" in skipped)]
    A = a.get("andrews")
    if A and A.get("rows"):
        t = A.get("turned") or {}
        how = ("incisors as traced" if A.get("incisors") != "e1" else "incisors first set upright over their roots"
               + "".join(f", {k} turned {v['deg']}° {v['way']}" for k, v in t.items()))
        calls.append(dict(title="Andrews' Six Elements",
                          call=str(A.get("shorthand") or ""),
                          detail="Distances from Andrews' goals (R = ahead, B = behind, G = on the goal): " + " · ".join(f"{r['name']}: {r['call']}" for r in A["rows"]) + f" · {how}"
                          + (f" · {A['heights']['call']}" if A.get("heights") else "")))
    notes = []
    if not any(r["unit"] == "mm" for r in rows):
        notes.append("The x-ray has no pixel size: millimetre values are missing.")
    if a.get("calibration_check"):
        notes.append("The pixel size looks wrong (S-N comes out an impossible length): treat millimetre values with care.")
    if "cvm" in skipped:
        notes.append("The vertebrae were not traced (adult, or skipped): no CVM stage.")
    elif vertebrae_unchecked:
        notes.append("The vertebrae (C2-C4) have not been checked yet: the CVM stage is only a guess.")
    cv = a.get("cvm") or {}
    if cv.get("overridden") and "cvm" not in skipped:
        notes.append("The CVM stage follows the doctor's own reading of the vertebrae.")
    if "soft" in skipped:
        notes.append("The soft tissue was not traced.")
    out = dict(age=_num(a.get("age")), sex=sex if sex in ("M", "F") else None,
               tracing="confirmed by the doctor" if case.get("status") == "confirmed" else "not confirmed yet",
               calls=calls, measurements=rows, notes=notes)
    if earlier:
        ec, ea = earlier
        mo = _months(ec.get("taken"), case.get("taken"))
        before = {m.get("key"): m for m in ea.get("measurements") or []}
        now = {m.get("key"): m for m in a.get("measurements") or []}
        ch = []
        for k in CHANGE_KEYS:
            b, n = _num((before.get(k) or {}).get("value")), _num((now.get(k) or {}).get("value"))
            if b is not None and n is not None:
                ch.append(dict(name=str(now[k].get("label") or k), before=b, now=n, unit=str(now[k].get("unit") or "")))
        if ch and mo is not None:
            out["change"] = dict(months=mo, age_before=_num(ea.get("age")), class_before=_call(ea, "sagittal"),
                                 cvm_before=_call(ea, "cvm") if "cvm" not in set(ec.get("skipped") or []) else None,
                                 rows=ch)
    return out


def signature(payload):
    """A fingerprint of this x-ray's own numbers: the write-up is marked out of date when they change."""
    own = {k: v for k, v in payload.items() if k != "change"}
    return hashlib.sha256(json.dumps(own, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


_NUM = re.compile(r"(?<![A-Za-z0-9.])[-+−]?\d+(?:\.\d+)?")


def _numbers_in(obj, out):
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        out.add(round(abs(float(obj)), 2))
    elif isinstance(obj, str):
        for t in _NUM.findall(obj):
            out.add(round(abs(float(t.replace("−", "-"))), 2))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers_in(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers_in(v, out)


def unverified_numbers(texts, payload):
    """Numbers in the write-up that are not among the numbers sent (as sent, or rounded to a whole or to one
    decimal): shown as a warning, so a figure the AI made up never passes for a measurement. A difference between a
    'before' and a 'now' value, and the years in the months between two x-rays, count as sent."""
    have = set()
    _numbers_in(payload, have)
    ok = set(have)
    for v in have:
        ok.add(float(round(v)))
        ok.add(round(v, 1))
    ch = payload.get("change") or {}
    for r in ch.get("rows") or []:
        d = abs(r["now"] - r["before"])
        ok.update({round(d, 2), round(d, 1), float(round(d))})
    if ch.get("months") is not None:
        y = ch["months"] / 12
        ok.update({round(y, 1), float(round(y)), float(ch["months"] % 12), float(ch["months"] // 12)})
    bad = []
    for text in texts:
        for t in _NUM.findall(text or ""):
            v = round(abs(float(t.replace("−", "-"))), 2)
            if v not in ok and t not in bad:
                bad.append(t)
    return bad


def _clean(s, n):
    return re.sub(r"\s+", " ", str(s or "")).strip()[:n]


def ask(payload, url=AISA_URL, timeout=TIMEOUT, opener=None):
    """Send the numbers, get {text, findings, check} back. Raises AiError with what to tell the person."""
    req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "NLO-XRay-Reader"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        try:
            msg = (json.loads(ex.read().decode("utf-8")) or {}).get("error")
        except Exception:  # noqa
            msg = None
        if ex.code == 404:
            raise AiError("AISA does not have the x-ray summary yet: the new aisa-worker.js has to be pasted into "
                          "Cloudflare first.")
        raise AiError(msg or f"AISA answered with an error ({ex.code}). Try again in a moment.")
    except (urllib.error.URLError, TimeoutError, OSError) as ex:
        raise AiError(f"This PC could not reach AISA ({getattr(ex, 'reason', ex)}). Check its internet connection "
                      "and try again.")
    except ValueError:
        raise AiError("AISA's answer could not be read. Try again.")
    if not isinstance(data, dict) or not data.get("ok"):
        raise AiError((isinstance(data, dict) and data.get("error")) or "AISA sent back nothing. Try again.")
    text = _clean(data.get("summary"), 2500)
    if not text:
        raise AiError("AISA sent back nothing. Try again.")
    lst = lambda v, m: [x for x in (_clean(i, 320) for i in (v if isinstance(v, list) else [])) if x][:m]  # noqa: E731
    return dict(text=text, findings=lst(data.get("findings"), 6), check=lst(data.get("check"), 3))
