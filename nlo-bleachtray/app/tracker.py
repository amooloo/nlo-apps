"""The link to NLO Cases (the case tracker): the queue of retainer / whitening / mouthguard cases waiting for
their models, and the note back when the models are sent.

NLO Cases keeps every case sealed with the office key, which this PC never has. So the tracker app writes a
small sealed copy of each case that is waiting for models - name, arches, what to make, due date - to its
`labq` collection, sealed to THIS app's own public key (made here, published to `labqkeys/<login>`), and
this app opens them with its private half: ECDH P-256 + HKDF-SHA256 + AES-256-GCM, the same box NLO Cases
uses between its own parts (`Crypto.sealTo` / `openFrom`). The login is the lab PC's robot login - the same
setup code as the NLO Lab Bridge (NLO Cases → Team & security → Lab PC) - which may only read the queue,
publish its key and add sealed items to NLO Cases' inbox; it can read nothing else.

When a case's models are sent to OrthoFactory, a sealed note goes to NLO Cases' inbox (to the office inbox
key, like the lab bridge's orders): the case notes "models in OrthoFactory" and leaves the queue.

The setup code and the private key are kept in `jobs/tracker.dat`, protected with Windows' own per-user
encryption (DPAPI) on Windows; elsewhere (tests) in the clear with a PLAIN: prefix.
"""
import base64, ctypes, json, os, secrets, sys, threading, time, urllib.error, urllib.parse, urllib.request

REFERER = "https://amooloo.github.io/nlo-apps/nlo-cases.html"
POLL_S = 60            # how often the queue is read
KEY_S = 6 * 3600       # how often the public key is published again (a fresh `at`, so NLO Cases knows this PC is alive)
VER = "1.0"


def _b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64u(s):
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def _unb64(s):
    return base64.b64decode(s + "=" * (-len(s) % 4))


# ---------------------------------------------------------------- Windows' per-user encryption for the saved code and key
def _dpapi(data, protect):
    if sys.platform != "win32":
        return None
    try:
        class BLOB(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_uint32), ("pb", ctypes.POINTER(ctypes.c_char))]
        crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(data, len(data))
        inp = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))); out = BLOB()
        fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
        if not fn(ctypes.byref(inp), "NLO Tray Maker", None, None, None, 0, ctypes.byref(out)):
            return None
        try:
            return ctypes.string_at(out.pb, out.cb)
        finally:
            kernel32.LocalFree(out.pb)
    except Exception:  # noqa
        return None


def _save_secret(path, obj):
    raw = json.dumps(obj).encode()
    prot = _dpapi(raw, True)
    with open(path, "w") as f:
        f.write("DPAPI:" + base64.b64encode(prot).decode() if prot else "PLAIN:" + raw.decode())


def _load_secret(path):
    if not os.path.exists(path):
        return None
    s = open(path).read().strip()
    if s.startswith("DPAPI:"):
        raw = _dpapi(base64.b64decode(s[6:]), False)
        return json.loads(raw) if raw else None
    if s.startswith("PLAIN:"):
        return json.loads(s[6:])
    return None


# ---------------------------------------------------------------- the sealed boxes (NLO Cases' Crypto.sealTo / openFrom)
def _crypto():
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return ec, hashes, serialization, HKDF, AESGCM


def new_keypair():
    """-> (private key PEM, public JWK)."""
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    priv = ec.generate_private_key(ec.SECP256R1())
    pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    return pem, pub_jwk(priv)


def pub_jwk(priv):
    n = priv.public_key().public_numbers()
    return dict(kty="EC", crv="P-256", x=_b64u(n.x.to_bytes(32, "big")), y=_b64u(n.y.to_bytes(32, "big")))


def _load_priv(pem):
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    return serialization.load_pem_private_key(pem.encode(), password=None)


def _jwk_pub(jwk):
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    x = int.from_bytes(_unb64u(jwk["x"]), "big"); y = int.from_bytes(_unb64u(jwk["y"]), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def _box_key(shared, info):
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"\0" * 32, info=info.encode()).derive(shared)


def open_from(priv, box, info):
    """Open a box {epk, iv, ct} sealed to our public key (info = the box's label, also its AAD) -> bytes."""
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    shared = priv.exchange(ec.ECDH(), _jwk_pub(box["epk"]))
    return AESGCM(_box_key(shared, info)).decrypt(_unb64(box["iv"]), _unb64(box["ct"]), info.encode())


def seal_to(pub_jwk_, data, info):
    """Seal bytes to a public JWK the way NLO Cases does -> {epk, iv, ct} (base64 as it stores them)."""
    ec, hashes, serialization, HKDF, AESGCM = _crypto()
    eph = ec.generate_private_key(ec.SECP256R1())
    shared = eph.exchange(ec.ECDH(), _jwk_pub(pub_jwk_))
    iv = secrets.token_bytes(12)
    ct = AESGCM(_box_key(shared, info)).encrypt(iv, data, info.encode())
    return dict(epk=pub_jwk(eph), iv=base64.b64encode(iv).decode(), ct=base64.b64encode(ct).decode())


# ---------------------------------------------------------------- the setup code (the lab PC's login, from NLO Cases)
def parse_code(code):
    code = (code or "").strip()
    if not code.startswith("NLOLAB1."):
        raise ValueError("That is not an NLO Cases lab PC setup code (it starts with NLOLAB1.)")
    try:
        j = json.loads(_unb64u(code[8:]).decode())
    except Exception:
        raise ValueError("The setup code is damaged - copy it again from NLO Cases (Team & security → Lab PC)")
    for k in ("p", "k", "e", "w"):
        if not j.get(k):
            raise ValueError("The setup code is incomplete - copy it again from NLO Cases")
    if not str(j["e"]).startswith("labbot."):
        raise ValueError("That is not a lab PC setup code - make one in NLO Cases (Team & security → Lab PC)")
    for k in ("ab", "tb", "fb"):
        if j.get(k) and not str(j[k]).startswith(("http://127.0.0.1", "http://localhost")):
            raise ValueError("That setup code points somewhere other than NLO Cases - make a new one in NLO Cases")
    return j


# ---------------------------------------------------------------- Firestore over HTTPS, as the lab PC's login
class FirestoreLite:
    def __init__(self, cfg, log=print):
        self.cfg = cfg; self.log = log
        self.auth = cfg.get("ab") or "https://identitytoolkit.googleapis.com/v1"
        self.tokb = cfg.get("tb") or "https://securetoken.googleapis.com/v1"
        self.fs = cfg.get("fb") or "https://firestore.googleapis.com/v1"
        self.tok = ""; self.ref = ""; self.until = 0.0; self.uid = ""

    def _json(self, method, url, body=None, tok=None):
        h = {"Referer": REFERER}
        if tok:
            h["Authorization"] = "Bearer " + tok
        data = None
        if body is not None:
            data = json.dumps(body).encode(); h["Content-Type"] = "application/json; charset=utf-8"
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode() or "null")
        except urllib.error.HTTPError as ex:
            det = ""
            try:
                det = ex.read().decode()[:300]
            except Exception:  # noqa
                pass
            e = RuntimeError(f"HTTP {ex.code} {det}".strip()); e.code = ex.code; raise e

    def token(self):
        if self.tok and time.time() < self.until:
            return self.tok
        if self.ref:
            try:
                body = urllib.parse.urlencode(dict(grant_type="refresh_token", refresh_token=self.ref)).encode()
                req = urllib.request.Request(self.tokb + "/token?key=" + urllib.parse.quote(self.cfg["k"]), data=body, method="POST",
                                             headers={"Referer": REFERER, "Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    j = json.loads(r.read().decode())
                self.tok, self.ref, self.until = j["id_token"], j["refresh_token"], time.time() + int(j["expires_in"]) - 300
                self.uid = j.get("user_id") or self.uid
                return self.tok
            except Exception:  # noqa
                self.ref = ""
        j = self._json("POST", self.auth + "/accounts:signInWithPassword?key=" + urllib.parse.quote(self.cfg["k"]),
                       dict(email=self.cfg["e"], password=self.cfg["w"], returnSecureToken=True))
        self.tok, self.ref, self.until = j["idToken"], j["refreshToken"], time.time() + int(j["expiresIn"]) - 300
        self.uid = j.get("localId") or ""
        return self.tok

    def doc_name(self, path):
        return f"projects/{self.cfg['p']}/databases/(default)/documents/{path}"

    def get(self, path):
        return self._json("GET", f"{self.fs}/{self.doc_name(path)}", None, self.token())

    def list(self, coll, page_size=300):
        out, token = [], None
        while True:
            q = f"?pageSize={page_size}" + (f"&pageToken={urllib.parse.quote(token)}" if token else "")
            j = self._json("GET", f"{self.fs}/{self.doc_name(coll)}{q}", None, self.token()) or {}
            out += j.get("documents") or []
            token = j.get("nextPageToken")
            if not token:
                return out

    def commit(self, writes):
        url = f"{self.fs}/projects/{self.cfg['p']}/databases/(default)/documents:commit"
        try:
            return self._json("POST", url, dict(writes=writes), self.token())
        except RuntimeError as ex:
            if getattr(ex, "code", 0) in (401, 403):
                self.tok = ""; self.until = 0
                return self._json("POST", url, dict(writes=writes), self.token())
            raise

    def delete(self, path):
        return self.commit([dict(delete=self.doc_name(path))])


def _val(v):
    """A Firestore REST value -> python."""
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return float(v["doubleValue"])
    if "booleanValue" in v: return bool(v["booleanValue"])
    if "timestampValue" in v: return v["timestampValue"]
    if "nullValue" in v: return None
    if "mapValue" in v: return {k: _val(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v: return [_val(x) for x in (v["arrayValue"].get("values") or [])]
    return None


def _fields(d):
    return {k: _val(v) for k, v in (d.get("fields") or {}).items()}


def _fv(x):
    """python -> a Firestore REST value (strings, maps of strings, ints, bools, lists)."""
    if isinstance(x, bool): return {"booleanValue": x}
    if isinstance(x, int): return {"integerValue": str(x)}
    if isinstance(x, float): return {"doubleValue": x}
    if isinstance(x, dict): return {"mapValue": {"fields": {k: _fv(v) for k, v in x.items()}}}
    if isinstance(x, (list, tuple)): return {"arrayValue": {"values": [_fv(v) for v in x]}}
    return {"stringValue": str(x)}


# ---------------------------------------------------------------- the link itself
class Tracker:
    def __init__(self, data_dir, log=print, pc_name=None):
        self.path = os.path.join(data_dir, "tracker.dat")
        self.cache = os.path.join(data_dir, "tracker_queue.json")
        self.log = log
        self.pc = pc_name or os.environ.get("COMPUTERNAME") or os.uname().nodename
        self.cfg = None; self.priv = None; self.pub = None; self.kid = ""
        self.fs = None
        self.items = {}            # case id -> the opened item (+ _at: when NLO Cases wrote it)
        self.sent = {}             # case id -> when this PC sent its models (stays out of the queue)
        self.status = dict(linked=False, last_ok=0, last_err="", n=0, email="", key_at=0)
        self.lock = threading.Lock(); self._stop = False; self._thread = None; self._wake = threading.Event()
        self._load()

    # ----- the saved link
    def _load(self):
        sec = _load_secret(self.path)
        if sec and sec.get("code"):
            try:
                self.cfg = parse_code(sec["code"]); self.fs = FirestoreLite(self.cfg, self.log)
                self.kid = sec.get("kid") or ""
                if sec.get("priv"):
                    self.priv = _load_priv(sec["priv"]); self.pub = pub_jwk(self.priv)
                self.status.update(linked=True, email=self.cfg["e"])
            except Exception as ex:  # noqa
                self.log(f"case tracker link: saved setup unusable ({ex})"); self.cfg = None
        try:
            c = json.load(open(self.cache)) if os.path.exists(self.cache) else {}
            self.items = c.get("items") or {}; self.sent = c.get("sent") or {}
        except Exception:  # noqa
            self.items, self.sent = {}, {}

    def _save_cache(self):
        try:
            tmp = self.cache + ".tmp"
            json.dump(dict(items=self.items, sent=self.sent), open(tmp, "w"))
            os.replace(tmp, self.cache)
        except Exception:  # noqa
            pass

    def link(self, code):
        """Save the setup code, make this PC's key if it has none, sign in and publish the key. Raises with a plain reason."""
        cfg = parse_code(code)
        fs = FirestoreLite(cfg, self.log)
        try:
            fs.token()
        except Exception as ex:  # noqa
            raise ValueError("NLO Cases refused the login - if the lab PC was turned off in NLO Cases, make a new setup code there (" + str(ex)[:120] + ")")
        sec = _load_secret(self.path) or {}
        if not sec.get("priv"):
            pem, pub = new_keypair(); sec["priv"] = pem; sec["kid"] = "lab" + secrets.token_hex(6)
        sec["code"] = code.strip()
        _save_secret(self.path, sec)
        with self.lock:
            self.cfg, self.fs = cfg, fs
            self.priv = _load_priv(sec["priv"]); self.pub = pub_jwk(self.priv); self.kid = sec["kid"]
            self.status.update(linked=True, email=cfg["e"], last_err="")
        self.publish_key()
        self.start(); self._wake.set()
        return self.state()

    def unlink(self):
        with self.lock:
            self.cfg = self.fs = None; self.items = {}
            self.status.update(linked=False, email="", n=0, last_err="")
        try:
            os.remove(self.path)
        except OSError:
            pass
        self._save_cache()

    # ----- the key this PC is written to
    def publish_key(self):
        if not self.fs or not self.pub:
            return
        w = dict(update=dict(name=self.fs.doc_name("labqkeys/" + self.fs.uid or ""),
                             fields=dict(pub=_fv(self.pub), kid=_fv(self.kid), name=_fv(("Tray Maker · " + self.pc)[:120]), ver=_fv("traymaker " + VER))),
                 updateTransforms=[dict(fieldPath="at", setToServerValue="REQUEST_TIME")])
        if not self.fs.uid:
            self.fs.token()
            w["update"]["name"] = self.fs.doc_name("labqkeys/" + self.fs.uid)
        self.fs.commit([w])
        self.status["key_at"] = time.time()

    # ----- the queue
    def poll(self):
        """Read the queue once. Items sealed to another key (an older one of this PC's) are left out."""
        if not self.fs or not self.priv:
            return
        docs = self.fs.list("labq")
        items, skipped = {}, 0
        for d in docs:
            f = _fields(d); cid = d["name"].rsplit("/", 1)[-1]
            if f.get("kid") != self.kid:
                skipped += 1; continue
            try:
                body = json.loads(open_from(self.priv, dict(epk=f["epk"], iv=f["iv"], ct=f["ct"]), "labq:" + cid).decode())
            except Exception as ex:  # noqa
                skipped += 1; continue
            body = _clean_item(body, cid); body["_at"] = f.get("at") or ""
            items[cid] = body
        with self.lock:
            self.items = items
            self.status.update(last_ok=time.time(), last_err="", n=len(items), skipped=skipped)
        self._save_cache()

    def state(self):
        with self.lock:
            st = dict(self.status); st["n"] = len(self.items); st["kid"] = self.kid; st["pc"] = self.pc
        return st

    def queue(self):
        with self.lock:
            out = []
            for cid, it in self.items.items():
                x = dict(it); x["case"] = cid
                x["sent_here"] = self.sent.get(cid) or 0
                out.append(x)
        out.sort(key=lambda x: (x.get("due") or "9999", x.get("created") or ""))
        return out

    # ----- the note back
    def sent_models(self, case_id, patient, models, how="orthofactory"):
        """The case's models went to OrthoFactory (`how` "orthofactory") or to the printer ("printer"): a sealed note to
        NLO Cases' inbox - its case notes them, moves on from To make to Printing, and leaves the queue."""
        if not self.fs or not case_id:
            return False
        ib = _fields(self.fs.get("meta/inbox"))
        pub, kid = ib.get("pub"), ib.get("kid")
        if not pub:
            raise RuntimeError("NLO Cases has no inbox key yet (Team & security → Email updates sets one up)")
        mid = "m" + secrets.token_hex(20)
        payload = dict(bt=1, v=1, case=case_id, patient=patient, models=list(models or []), at=int(time.time() * 1000), pc=self.pc,
                       how=str(how or "")[:20])
        box = seal_to(pub, json.dumps(payload).encode(), "inbox:" + mid)
        w = dict(update=dict(name=self.fs.doc_name("inbox/" + mid),
                             fields=dict(kid=_fv(kid or ""), epk=_fv(box["epk"]), iv=_fv(box["iv"]), ct=_fv(box["ct"]))),
                 currentDocument=dict(exists=False), updateTransforms=[dict(fieldPath="at", setToServerValue="REQUEST_TIME")])
        self.fs.commit([w])
        with self.lock:
            self.sent[case_id] = time.time()
            # (the queue copy stays until NLO Cases has read the note; it is hidden here meanwhile)
        self._save_cache()
        return True

    # ----- the loop
    def start(self):
        if self._thread or not self.cfg:
            return
        self._thread = threading.Thread(target=self._run, name="tracker", daemon=True); self._thread.start()

    def stop(self):
        self._stop = True; self._wake.set()

    def _run(self):
        last_key = 0
        while not self._stop:
            if self.cfg:
                try:
                    if time.time() - last_key > KEY_S:
                        self.publish_key(); last_key = time.time()
                    self.poll()
                except Exception as ex:  # noqa
                    with self.lock:
                        self.status["last_err"] = str(ex)[:200]
                    self.log(f"case tracker link: {ex}")
            self._wake.wait(POLL_S); self._wake.clear()

    def refresh(self):
        self._wake.set()


def _clean_item(b, cid):
    """Only the fields the page shows, as plain text / lists (the box came from NLO Cases, but still)."""
    s = lambda k, n=120: str(b.get(k) or "")[:n]
    arches = [str(a).lower() for a in (b.get("arches") or []) if str(a).lower() in ("upper", "lower")]
    kinds = " ".join(str(k) for k in (b.get("retKinds") or []))
    make = []
    ku = kinds.upper()
    if b.get("type") == "mouthguard":
        make = ["MG"]
    elif "COTT" in ku or "BOTT" in ku or "PHASE" in ku or "PHASE" in str(b.get("stage") or "").upper():
        make = ["P1"]            # a Phase I retainer (COTT / BOTT in NLO Cases' retainer kinds)
    else:
        if "WT" in ku: make.append("WT")
        if "TT" in ku or not make: make.append("TT")
    return dict(patient=s("patient"), chart=s("chart", 40), type=s("type", 20), arches=arches, make=make, kinds=kinds[:60],
                remake=s("remake", 40), scanOnFile=bool(b.get("scanOnFile")), due=s("dueDate", 20), delivery=s("deliveryDate", 20),
                assignee=s("assignee", 60), created=s("createdAt", 30), stage=s("stage", 20), by=s("by", 60))
