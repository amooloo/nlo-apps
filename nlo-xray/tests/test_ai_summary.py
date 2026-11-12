"""The AI summary: only numbers leave this PC, the write-up is kept with the x-ray, checked and marked when stale."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from test_server import _traced_case, client  # noqa: F401
from xray import ai_summary

SECRETS = ("Jane", "Doe", "2013-01-02", "2013", "2026-10-15", "2025-06-01", "C-4471", "private note", "landmarks")


class FakeAisa:
    """A stand-in for the Worker's /ceph-summary on this machine: keeps what it was sent, answers what it is told."""

    def __init__(self):
        self.got = []
        self.reply = (200, dict(ok=True, summary="A 13.8-year-old female with a skeletal Class I pattern.",
                                findings=["ANB within norms"], check=[]))
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
                outer.got.append((self.path, dict(self.headers), raw))
                code, body = outer.reply
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_port}/ceph-summary"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


@pytest.fixture()
def aisa(monkeypatch):
    f = FakeAisa()
    monkeypatch.setenv("NLO_XRAY_AI_URL", f.url)
    yield f
    f.close()


def _case(client, **kw):
    cid, _ = _traced_case(client, **kw)
    client.patch(f"/api/cases/{cid}", json={"patient": {"chart": "C-4471"}, "notes": "private note about Jane",
                                            "calibration": {"mm_per_px": 0.24, "source": "ruler"}})
    return cid


def test_only_numbers_leave_and_the_writeup_is_kept(client, aisa):
    cid = _case(client, taken="2026-10-15")
    r = client.get(f"/api/cases/{cid}").json()
    assert r["analysis"]["ai"] == {"on": True, "stale": False} and "ai" not in r["case"]
    # what the page shows as "what is sent" is what goes
    shown = client.get(f"/api/cases/{cid}/ai-summary").json()["sends"]
    r = client.post(f"/api/cases/{cid}/ai-summary")
    assert r.status_code == 200, r.text
    path, headers, raw = aisa.got[0]
    assert path == "/ceph-summary" and json.loads(raw) == shown
    for s in SECRETS:
        assert s not in raw, s
    sent = json.loads(raw)
    assert set(sent) == {"age", "sex", "tracing", "calls", "measurements", "notes"}
    assert sent["sex"] == "F" and sent["age"] == pytest.approx(13.8, abs=0.1) and sent["tracing"] == "confirmed by the doctor"
    assert {"SNA", "ANB", "SNB"} <= {m["name"] for m in sent["measurements"]}
    assert all(set(m) == {"name", "group", "value", "unit", "norm", "sd_off"} for m in sent["measurements"])
    assert any(c["title"] == "Skeletal class" for c in sent["calls"])
    # kept with the x-ray, shown as current
    body = r.json()
    ai = body["case"]["ai"]
    assert ai["text"].startswith("A 13.8-year-old") and ai["findings"] == ["ANB within norms"] and ai["unverified"] == []
    assert body["analysis"]["ai"] == {"on": True, "stale": False}
    assert client.get(f"/api/cases/{cid}").json()["case"]["ai"]["text"] == ai["text"]
    # the tracing still counts as confirmed (the write-up is no change to the lesson)
    assert body["case"]["status"] == "confirmed"
    # a point moved -> out of date
    lm = body["case"]["landmarks"]["A"]
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {"A": {"x": lm["x"] + 14, "y": lm["y"], "by": "doctor"}}}).json()
    assert r["analysis"]["ai"]["stale"] is True and r["case"]["ai"]["text"] == ai["text"]
    # removed
    r = client.delete(f"/api/cases/{cid}/ai-summary").json()
    assert "ai" not in r["case"] and r["analysis"]["ai"]["stale"] is False


def test_an_earlier_xray_goes_as_before_with_months_not_dates(client, aisa):
    _case(client, seed=1, taken="2025-06-01")
    cid = _case(client, seed=2, taken="2026-10-15")
    assert client.post(f"/api/cases/{cid}/ai-summary").status_code == 200
    raw = aisa.got[0][2]
    for s in SECRETS:
        assert s not in raw, s
    ch = json.loads(raw)["change"]
    assert ch["months"] == 16 and ch["age_before"] == pytest.approx(12.4, abs=0.1)
    assert ch["rows"] and all(set(r) == {"name", "before", "now", "unit"} for r in ch["rows"])
    assert client.get(f"/api/cases/{cid}").json()["case"]["ai"]["compared"] is True


def test_a_number_the_ai_made_up_is_flagged(client, aisa):
    cid = _case(client)
    aisa.reply = (200, dict(ok=True, summary="ANB is 47.3° and the patient is in CS3.", findings=[], check=[]))
    ai = client.post(f"/api/cases/{cid}/ai-summary").json()["case"]["ai"]
    assert ai["unverified"] == ["47.3"]


def test_off_in_settings_and_errors_in_plain_words(client, aisa):
    cid = _case(client)
    # AISA without the route yet
    aisa.reply = (404, dict(error="Not found"))
    r = client.post(f"/api/cases/{cid}/ai-summary")
    assert r.status_code == 502 and "Cloudflare" in r.json()["detail"]
    aisa.reply = (429, dict(ok=False, error="The AI helper has reached its daily limit."))
    assert "daily limit" in client.post(f"/api/cases/{cid}/ai-summary").json()["detail"]
    assert "ai" not in client.get(f"/api/cases/{cid}").json()["case"]
    # off: nothing is sent
    n = len(aisa.got)
    assert client.put("/api/settings", json={"ai": {"enabled": False}}).json()["ai"] == {"enabled": False}
    assert client.post(f"/api/cases/{cid}/ai-summary").status_code == 403 and len(aisa.got) == n
    assert client.get(f"/api/cases/{cid}").json()["analysis"]["ai"]["on"] is False


def test_not_before_the_points_are_placed(client, aisa):
    from test_server import png_bytes
    data, _, _ = png_bytes(5)
    cid = client.post("/api/cases", files=[("files", ("x.png", data, "image/png"))]).json()[0]["id"]
    assert client.post(f"/api/cases/{cid}/ai-summary").status_code == 409 and not aisa.got


def test_unverified_numbers_allows_what_was_sent():
    p = dict(age=12.5, measurements=[dict(name="ANB", value=5.24, unit="°", norm="2 ± 2", sd_off=1.62)],
             calls=[dict(title="Growth (CVM)", call="CS3 · CVMI 3", detail="65-85 % of growth to come")],
             change=dict(months=14, rows=[dict(name="ANB", before=6.0, now=5.24, unit="°")]))
    ok = "A 12.5-year-old: ANB 5.2° (norm 2 ± 2), down 0.8° over 14 months; CS3, 65-85 % of growth to come; U1 and C3."
    assert ai_summary.unverified_numbers([ok], p) == []
    assert ai_summary.unverified_numbers(["SNA 91° and ANB 5.24°"], p) == ["91"]
