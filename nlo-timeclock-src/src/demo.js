/* =====================================================================
   The demo (?demo): a made-up office in memory, nothing saved. It acts
   like the real database's rules for everything a person can try
   (5 PIN tries in 10 minutes, punching only right after a PIN, on a
   phone or computer only on the office network, from home only on an
   approved laptop, nobody correcting their own time except Dr. A, only
   Dr. A changing settings). The office lock is on; the bar at the bottom
   switches where this device pretends to be (the office, or home).
   It's always Thursday afternoon in the demo (the most recent Thursday,
   2:40 PM, and the clock runs on from there), so there's a week of
   punches to look at whatever day it's opened.
   ===================================================================== */
const DEMO = (() => {
  const PIN = '1357';
  const H = TCE.HOUR, MIN = TCE.MIN;
  const people = [
    ['s_owner', 'Dr. A', 'owner'], ['s_morgan', 'Morgan Lee', 'staff'], ['s_robin', 'Robin Hale', 'staff'], ['s_jamie', 'Jamie Cruz', 'staff'],
    ['s_taylor', 'Taylor Brooks', 'staff'], ['s_casey', 'Casey Park', 'staff'], ['s_avery', 'Avery Diaz', 'staff'], ['s_quinn', 'Quinn Reyes', 'staff']
  ];
  const D = {
    me: null, mgr: false, kiosk: null, skew: 0, unsubs: [], onSync: null, noIndex: false,
    roster: [], staff: {}, pins: {}, tries: {}, punches: [], fixes: [], ot: [], reqs: [], reqN: {}, mgrs: ['s_morgan'], set: null, alerts: null, kiosks: [], beat: [], sent: [], bots: [],
    laptops: [], lapReqs: [], offices: [], seen: {}, where: 'office', listeners: []
  };
  let seeded = false;
  function seed() {
    if (seeded) return; seeded = true;
    const real = Date.now(); let target = real;
    for (let i = 0; i < 9; i++) { const iso = TCE.addDays(TCE.dayOf(real), -i); if (TCE.dow(iso) === 4 && TCE.atTime(iso, '14:40') <= real) { target = TCE.atTime(iso, '14:40'); break; } }
    D.skew = target - real;
    const now = target, thu = TCE.dayOf(now), mon = TCE.addDays(thu, -3), tue = TCE.addDays(thu, -2), wed = TCE.addDays(thu, -1);
    D.roster = people.map(([sid, name, role]) => ({ id: sid, name, role, active: true, initials: initials(name) }));
    const on = { on: true, home: false, hdays: [], early: '', cap: 0, pinAt: now - 30 * TCE.DAY, at: now - 30 * TCE.DAY, by: 'u_owner' };
    people.forEach(([sid, , role]) => { D.staff[sid] = Object.assign({}, on, { on: role !== 'owner' }); if (role !== 'owner') D.pins[sid] = PIN; });
    D.staff.s_jamie = Object.assign({}, on, { home: true, hdays: [2, 4] });
    D.staff.s_quinn = Object.assign({}, on, { home: true, hdays: [], sal: true });
    D.staff.s_avery = Object.assign({}, on, { cap: 24 });
    D.set = Object.assign({ at: now - 30 * TCE.DAY }, TCE.DEFAULTS, { pay: TCE.weekOf(TCE.addDays(thu, -14), 0), lock: true, wurl: 'https://nlo-office-check.demo.workers.dev' });
    // the office lock: the office's network, and the two laptops approved for working from home
    D.offices = [{ id: NET.office.net, name: 'Office Wi-Fi', org: NET.office.org, city: NET.office.city, by: 'u_owner', at: now - 20 * TCE.DAY }];
    D.laptops = [{ id: 'l_jamie', name: 'Remote laptop', sids: ['s_jamie'], at: now - 20 * TCE.DAY, by: 'u_owner', seen: now - 4 * MIN },
      { id: 'l_quinn', name: 'Quinn’s laptop', sids: ['s_quinn'], at: now - 20 * TCE.DAY, by: 'u_owner', seen: now - 9 * MIN }];
    // a laptop asking Dr. A to approve it (its screen shows the code: in the demo, LAP_CODE)
    D.lapReqs = [{ id: 'l_new', code: LAP_CODE, dev: 'Chrome on Windows', at: now - 2 * MIN }];
    D.seen.k_front = Object.assign({ at: now - 3 * MIN, pid: '' }, NET.office);
    D.alerts = { emails: ['dr.a@example.com'], topic: 'nlo-clock-demo0000', route: {}, digest: '18:00', test: null, at: now - 7 * TCE.DAY };
    let n = 0;
    // (src 'home': from home on their approved laptop; 'own': their own phone at the office)
    const P = (sid, kind, iso, hm, src, net) => D.punches.push({ id: 'p' + String(++n).padStart(24, '0'), sid, kind, at: TCE.atTime(iso, hm),
      src: src === 'home' ? 'laptop' : src || 'kiosk', net: net || (src === 'home' ? 'off' : 'office'), by: src === 'home' ? (sid === 's_quinn' ? 'l_quinn' : 'l_jamie') : src === 'own' ? 'u_' + sid : 'k_front' });
    const day = (sid, iso, a, l, b, o, src) => { P(sid, 'in', iso, a, src); if (l) { P(sid, 'lunch', iso, l, src); P(sid, 'back', iso, b, src); } if (o) P(sid, 'out', iso, o, src); };
    // Robin: long days — at 36.7 h on Thursday afternoon, overtime around 5:50 PM if still clocked in
    [mon, tue, wed].forEach(d => day('s_robin', d, '07:32', '12:00', '12:30', '18:00'));
    day('s_robin', thu, '07:21', '12:00', '12:20', null); // (before 7:30: flagged)
    // Jamie: at the office, and a few hours from home here and there (allowed Tuesday and Thursday)
    day('s_jamie', mon, '08:00', '12:00', '12:30', '16:30');
    day('s_jamie', tue, '08:00', '12:00', '12:30', '16:30');
    P('s_jamie', 'in', tue, '19:30', 'home'); P('s_jamie', 'out', tue, '21:00', 'home');
    day('s_jamie', wed, '08:00', '12:00', '12:30', '16:30');
    day('s_jamie', thu, '08:00', null, null, '12:00'); // (at the office this morning, from home this afternoon)
    P('s_jamie', 'in', thu, '13:00', 'home');
    // Quinn: salaried, from home most days — the hours are kept for the record (no overtime, no alerts about them)
    [mon, tue, wed].forEach(d => { P('s_quinn', 'in', d, '08:30', 'home'); P('s_quinn', 'out', d, '12:30', 'home'); P('s_quinn', 'in', d, '13:00', 'home'); P('s_quinn', 'out', d, '17:30', 'home'); });
    P('s_quinn', 'in', thu, '08:30', 'home');
    // Taylor: forgot to clock out on Wednesday; clocks in on her phone at the office
    day('s_taylor', mon, '07:55', '12:00', '12:30', '17:00');
    day('s_taylor', tue, '07:58', '12:00', '12:30', '17:05');
    day('s_taylor', wed, '07:50', '12:00', '12:30', null);
    day('s_taylor', thu, '07:52', '12:00', '12:30', null, 'own');
    // Casey: long days (a 12-minute break on Monday, paid) — 40.5 h by lunch today, overtime not approved; at lunch right now
    P('s_casey', 'in', mon, '07:30'); P('s_casey', 'lunch', mon, '10:00'); P('s_casey', 'back', mon, '10:12'); P('s_casey', 'lunch', mon, '12:30'); P('s_casey', 'back', mon, '13:00'); P('s_casey', 'out', mon, '19:15');
    [tue, wed].forEach(d => day('s_casey', d, '07:30', '12:30', '13:00', '19:15'));
    P('s_casey', 'in', thu, '07:30'); P('s_casey', 'lunch', thu, '14:15');
    // Avery: part-time, a 24-hour cap
    [mon, tue, wed].forEach(d => day('s_avery', d, '08:00', null, null, '13:30'));
    day('s_avery', thu, '08:00', null, null, '13:00');
    // Morgan: regular days (on Tuesday morning the office's internet was down a moment: the time clock couldn't check the
    // network, so that clock-in is flagged)
    [mon, wed].forEach(d => day('s_morgan', d, '07:45', '12:00', '12:30', '16:45'));
    P('s_morgan', 'in', tue, '07:45', 'kiosk', 'unk'); P('s_morgan', 'lunch', tue, '12:00'); P('s_morgan', 'back', tue, '12:30'); P('s_morgan', 'out', tue, '16:45');
    day('s_morgan', thu, '07:45', '12:00', '12:30', null);
    // Taylor asked for Wednesday's clock-out at the time clock this morning; Avery left a note when she left
    D.reqs.push({ id: 'r' + '1'.padStart(24, '0'), sid: 's_taylor', ps: [{ k: 'out', t: TCE.atTime(wed, '17:10') }], note: 'Forgot to punch out, left at 5:10', src: 'kiosk', by: 'k_front', at: TCE.atTime(thu, '07:52') + 40000, st: 'open' });
    D.reqs.push({ id: 'r' + '2'.padStart(24, '0'), sid: 's_avery', ps: [], note: 'Left at 1 for a dentist appointment (Morgan knew)', src: 'kiosk', by: 'k_front', at: TCE.atTime(thu, '13:00') + 30000, st: 'open' });
    D.kiosks = [{ id: 'k_front', name: 'Front desk', at: now - 30 * TCE.DAY, by: 'u_owner', seen: now - 3 * MIN }];
    D.beat = [{ id: 'b_demo', box: 'records@ (the office Gmail)', ver: '1', err: '', sent: 0, at: now - 2 * MIN }];
    const sent = (mins, type, sid, text) => D.sent.push({ id: 'a' + String(D.sent.length).padStart(32, '0'), k: type + '|' + sid, type, sid, text, st: 'sent', ch: 3, at: now - mins * MIN, up: now - mins * MIN });
    sent(400, 'miss', 's_taylor', 'Taylor didn’t clock out ' + TCE.dayText(wed) + '\nTaylor clocked in at 7:50 AM on ' + TCE.dayText(wed, true) + ' and never clocked out. Until a manager adds the clock-out, that shift counts 0 hours.');
    sent(338, 'early', 's_robin', 'Robin clocked in early: 7:21 AM\nRobin clocked in at 7:21 AM on ' + TCE.dayText(thu) + '. The earliest set is 7:30 AM. Flagged on the timesheet.');
    sent(98, 'home', 's_jamie', 'Jamie clocked in from home\nJamie clocked in from home at 1:00 PM on ' + TCE.dayText(thu) + '.');
    sent(405, 'req', 's_taylor', 'Taylor asked for a missed punch\nTaylor asked at the time clock (7:52 AM on ' + TCE.dayText(thu) + ') for a punch they missed: Clock out 5:10 PM, ' + TCE.dayText(wed) + '. Note: “Forgot to punch out, left at 5:10”. It counts once a manager approves it on the Now screen.');
    sent(98, 'req', 's_avery', 'Avery left a note for the managers\nAvery wrote at the time clock (1:00 PM on ' + TCE.dayText(thu) + '): “Left at 1 for a dentist appointment (Morgan knew)”. Mark it done on the Now screen.');
    sent(55, 'ot', 's_casey', 'Overtime: Casey is at 40 h\nCasey passed 40 h this workweek without overtime approved ahead of time. Clocked in since 7:30 AM.');
    sent(22, 'thr', 's_robin', 'Robin: 36 h this week\nRobin has 36 h this workweek (overtime after 40 h). Clocked in since 12:20 PM. Reaches 40 h at 5:54 PM today if still clocked in.');
  }
  const now = () => Date.now() + D.skew;
  // where the demo pretends this device is (the bar at the bottom)
  const NET = { office: { net: 'v4:203.0.113.10', org: 'Demo Internet', city: 'Gainesville, Florida', relay: false }, home: { net: 'v4:198.51.100.7', org: 'Home Internet', city: 'Gainesville, Florida', relay: false } };
  const LAP_CODE = '482913';
  const copy = x => JSON.parse(JSON.stringify(x));
  const deny = () => { throw errCode('permission-denied', 'Missing or insufficient permissions.'); };
  const mySid = () => D.me ? D.me.staffId : '';
  const isOwner = () => !!(D.me && D.me.role === 'owner');
  const onClock = sid => !!(D.staff[sid] && D.staff[sid].on && D.roster.some(r => r.id === sid && r.active));
  const lap = () => (D.kiosk && D.kiosk.kind === 'laptop' ? D.laptops.find(l => l.id === D.kiosk.uid) : null);
  const forDev = sid => { if (!D.kiosk) return false; if (D.kiosk.kind !== 'laptop') return D.kiosks.some(k => k.id === D.kiosk.uid); const l = lap(); return !!(l && l.sids.includes(sid)); };
  // like the rules: the office check saw this login on a saved office network in the last 2 minutes, and gave its page
  // this punch number (one check, one punch)
  const atOffice = (uid, pid) => { const x = D.seen[uid]; return !!(x && pid && x.pid === pid && now() - x.at < 2 * MIN && D.offices.some(o => o.id === x.net) && !D.punches.some(p => p.id === pid)); };
  // this time clock (or laptop) took this person's right PIN in the last few minutes
  const pinOk = (sid, mins) => { const c = D.tries[sid]; return !!(c && c.ok && D.kiosk && c.k === D.kiosk.uid && now() <= c.at + mins * MIN); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function emit() {
    D.listeners.forEach(L => {
      const o = L.o, on = L.on, sid = o.sid;
      on('set', Object.assign({ id: 'tc' }, D.set));
      if (o.role === 'laptop') {
        const mine = x => (o.sids || []).includes(x.sid), self = D.kiosk && D.laptops.find(l => l.id === D.kiosk.uid);
        on('lapself', self ? copy(self) : null);
        if (!self) return;
        on('roster', copy(D.roster.filter(r => (o.sids || []).includes(r.id))));
        on('staff', Object.keys(D.staff).filter(k => (o.sids || []).includes(k)).map(k => Object.assign({ id: k }, D.staff[k])));
        on('punch', D.punches.filter(p => mine(p) && p.at >= o.from).map(copy));
        on('fix', D.fixes.filter(mine).map(copy)); on('ot', D.ot.filter(mine).map(copy)); on('req', D.reqs.filter(mine).map(copy));
        on('try', Object.keys(D.tries).filter(k => (o.sids || []).includes(k)).map(k => Object.assign({ id: k }, D.tries[k])));
        return;
      }
      on('roster', copy(D.roster));
      if (o.role === 'staff') {
        on('staff1', D.staff[sid] ? Object.assign({ id: sid }, D.staff[sid]) : null);
        on('punch', D.punches.filter(p => p.sid === sid).map(copy));
        on('fix', D.fixes.filter(f => f.sid === sid).map(copy));
        on('ot', D.ot.filter(x => x.sid === sid).map(copy));
        on('req', D.reqs.filter(x => x.sid === sid).map(copy));
        return;
      }
      on('req', D.reqs.map(copy));
      on('staff', Object.keys(D.staff).map(k => Object.assign({ id: k }, D.staff[k])));
      on('punch', D.punches.filter(p => p.at >= o.from).map(copy));
      on('fix', D.fixes.filter(f => f.at >= o.from - H).map(copy));
      on('ot', D.ot.map(copy));
      on('try', Object.keys(D.tries).map(k => Object.assign({ id: k }, D.tries[k])));
      if (o.role === 'mgr') {
        on('mgrs', D.mgrs.map(id => ({ id })));
        on('kiosks', copy(D.kiosks)); on('beat', copy(D.beat)); on('laptops', copy(D.laptops));
        if (isOwner()) { on('offices', copy(D.offices)); on('lapreqs', copy(D.lapReqs)); }
        on('sent', D.sent.slice().sort((a, b) => b.at - a.at).slice(0, 60).map(copy));
        on('alerts', Object.assign({ id: 'tcAlerts' }, D.alerts));
      }
    });
  }
  const later = () => setTimeout(emit, 0);
  const B = {
    demo: true, PIN,
    get me() { return D.me; }, get mgr() { return D.mgr; }, get kiosk() { return D.kiosk; }, get skew() { return D.skew; },
    get noIndex() { return false; }, indexLink: '',
    set onSync(f) { D.onSync = f; }, get onSync() { return D.onSync; },
    pending: 0,
    seedNow() { seed(); },
    now, isOwner, isMgr: () => !!D.mgr, tsMs: t => (typeof t === 'number' ? t : 0),
    isPerm: e => /permission/i.test((e && (e.code || e.message)) || ''),
    async restore() { seed(); return { kiosk: null, person: null, kioskGone: false, lapWait: null }; },
    /* the demo's people: 'owner' | 'manager' | 'home' | 'staff' */
    async signInAs(who) {
      seed(); await wait(150);
      const sid = { owner: 's_owner', manager: 's_morgan', home: 's_jamie', staff: 's_taylor' }[who] || 's_taylor';
      const r = D.roster.find(x => x.id === sid);
      D.me = { uid: 'u_' + sid, staffId: sid, role: r.role, name: r.name, email: sid === 's_owner' ? 'dr.a@example.com' : '' };
      D.mgr = sid === 's_owner' || D.mgrs.includes(sid);
      return D.me;
    },
    async signIn() { throw errCode('demo', 'In the demo, pick who to be below.'); },
    async signOut() { B.stop(); D.me = null; D.mgr = false; },
    async kioskEnroll(name) { if (!isOwner()) deny(); seed(); D.kiosk = { uid: 'k_' + hexId(4), name, kind: 'clock', sids: [] }; D.kiosks.push({ id: D.kiosk.uid, name, at: now(), by: D.me.uid, seen: now() }); later(); return D.kiosk; },
    /* a laptop asking to be approved: in the demo one is already waiting (Dr. A → Settings → Approved laptops), and its
       code is LAP_CODE */
    LAP_CODE,
    async lapAsk() { throw errCode('demo', 'In the demo a laptop is already asking: sign in as Dr. A → Settings → Approved laptops.'); },
    async lapAsked() { return null; },
    lapWait() { return () => { }; },
    async lapCancel() { },
    async lapApprove(uid, name, sids) {
      await wait(200); if (!isOwner() || !D.lapReqs.some(q => q.id === uid && now() - q.at < 30 * MIN)) deny(); // (a code works for 30 minutes)
      D.laptops.push({ id: uid, name, sids: sids.slice(), at: now(), by: D.me.uid });
      D.lapReqs = D.lapReqs.filter(q => q.id !== uid); later();
    },
    async lapDecline(uid) { await wait(120); if (!isOwner()) deny(); D.lapReqs = D.lapReqs.filter(q => q.id !== uid); later(); },
    async lapSelfNow() { const l = D.kiosk && D.laptops.find(x => x.id === D.kiosk.uid); return l ? copy(l) : null; },
    /* the demo's time clocks: the front desk, or Jamie's approved laptop */
    async kioskOpen(kind) {
      seed();
      if (kind === 'laptop') { const l = D.laptops.find(x => x.id === 'l_jamie') || D.laptops[0]; D.kiosk = { uid: l.id, name: l.name, kind: 'laptop', sids: l.sids.slice() }; }
      else D.kiosk = { uid: 'k_front', name: 'Front desk', kind: 'clock', sids: [] };
      return D.kiosk;
    },
    async kioskForget() { B.stop(); D.kiosk = null; },
    async kioskSeen() { const k = D.kiosk && (D.kiosks.find(x => x.id === D.kiosk.uid) || D.laptops.find(x => x.id === D.kiosk.uid)); if (k) k.seen = now(); },
    /* the office check: where this device pretends to be (and it's written down, like the real one) */
    get where() { return D.where; },
    setWhere(w) { D.where = w === 'home' ? 'home' : 'office'; },
    async netCheck(url, asDevice) {
      await wait(350);
      if (!url) throw errCode('no-check', 'The office check isn’t set up yet.');
      const n = NET[D.where], uid = asDevice ? (D.kiosk && D.kiosk.uid) : (D.me && D.me.uid);
      if (!uid) throw errCode('not-signed-in', 'Not signed in.');
      const office = D.offices.some(o => o.id === n.net), pid = 'p' + hexId(12);
      D.seen[uid] = Object.assign({ office, pid, at: now() }, n);
      return Object.assign({ office, pid, bot: 'tc-check-demo00000000' }, n);
    },
    async seenOf(uid) { const x = D.seen[uid]; if (!x) return null; const c = copy(x); delete c.pid; return c; },
    async makeNetBot() { await wait(200); if (!isOwner()) deny(); return { email: 'tc-check-demo00000000@example.com', password: 'demo-only', uid: 'n_demo' }; },
    async netBotsKeep() { return 'new'; },
    async netBots() { return [{ uid: 'n_demo', local: 'tc-check-demo00000000', at: now() - 20 * TCE.DAY }]; },
    async netBotsOnlyNewest() { return 0; },
    async netBotDrop() { },
    checkConfig() { return { projectId: 'demo', apiKey: 'demo', botEmail: 'tc-check-demo00000000@example.com', botPassword: 'demo-only', origins: [], referer: APP_URL }; },
    // (like the rules: the network the office check saw Dr. A's own login on in the last 5 minutes, never a shared address)
    async saveOffice(net, name, seen) {
      await wait(150); if (!isOwner()) deny();
      const x = D.seen[D.me.uid]; if (!x || x.net !== net || x.relay || now() - x.at > 5 * MIN) deny();
      D.offices = D.offices.filter(o => o.id !== net).concat([{ id: net, name, org: seen.org || '', city: seen.city || '', by: D.me.uid, at: now() }]); later();
    },
    async renameOffice(net, name) { if (!isOwner()) deny(); const o = D.offices.find(x => x.id === net); if (o) o.name = name; later(); },
    async removeOffice(net) { if (!isOwner()) deny(); D.offices = D.offices.filter(x => x.id !== net); later(); },
    async laptopSave(uid, name, sids) { if (!isOwner()) deny(); const l = D.laptops.find(x => x.id === uid); if (l) { l.name = name; l.sids = sids.slice(); } later(); },
    async laptopRemove(uid) { if (!isOwner()) deny(); D.laptops = D.laptops.filter(x => x.id !== uid); later(); },
    async rulesOk() { return true; },
    async isSetUp() { return !!D.set; },
    watch(o, on) { B.stop(); const L = { o, on }; D.listeners.push(L); D.unsubs.push(() => { D.listeners = D.listeners.filter(x => x !== L); }); setTimeout(emit, 0); },
    stop() { D.unsubs.forEach(u => u()); D.unsubs = []; },
    async loadRange(from, to) {
      await wait(120);
      return { punches: D.punches.filter(p => p.at >= from && p.at < to).map(copy), fixes: D.fixes.filter(f => f.at >= from - H).map(copy), ot: D.ot.map(copy) };
    },
    async pinTry(sid, pin) {
      await wait(250);
      if (!forDev(sid) || !onClock(sid)) deny();
      const t = now(), cur = D.tries[sid];
      let n;
      if (!cur || t > cur.t0 + 10 * MIN) { D.tries[sid] = { n: 1, t0: t, at: t, ok: false, k: D.kiosk.uid }; n = 1; }
      else if (cur.n < 5) { cur.n++; cur.at = t; cur.ok = false; cur.k = D.kiosk.uid; n = cur.n; }
      else return { ok: false, locked: true, until: cur.t0 + 10 * MIN };
      later();
      if (D.pins[sid] && D.pins[sid] === pin) { D.tries[sid].ok = true; return { ok: true }; }
      return { ok: false, left: 5 - n, locked: n >= 5, until: D.tries[sid].t0 + 10 * MIN };
    },
    async pinRelease(sid) { const c = D.tries[sid]; if (c && c.ok) { D.tries[sid] = { n: 0, t0: now(), at: now(), ok: false, k: '' }; later(); } },
    async punch(sid, kind, net, pid) {
      await wait(200);
      const laptop = !!lap();
      if (!forDev(sid) || !onClock(sid) || !pinOk(sid, 5)) deny();
      net = net || '';
      if (net === 'office' && !atOffice(D.kiosk.uid, pid)) deny();
      if (!laptop && net === '' && D.set.lock) deny();
      if (laptop && net !== 'office' && (!(kind === 'in' || kind === 'out') || !D.staff[sid].home)) deny();
      const p = { id: net === 'office' ? pid : 'p' + hexId(12), sid, kind, at: now(), src: laptop ? 'laptop' : 'kiosk', net, by: D.kiosk.uid };
      D.punches.push(p); D.tries[sid] = { n: 0, t0: now(), at: now(), ok: false, k: '' }; later();
      return { id: p.id, at: p.at };
    },
    async pinChange(sid, pin) {
      await wait(200);
      if (!forDev(sid) || !D.staff[sid] || !pinOk(sid, 5)) deny();
      D.pins[sid] = pin; D.staff[sid].pinAt = now(); D.staff[sid].pinBy = 'self'; D.tries[sid] = { n: 0, t0: now(), at: now(), ok: false, k: '' }; later();
    },
    async ping() { },
    /* asking a manager to fix their time (as the rules: at the time clock within 10 minutes of the PIN; signed in, their
       own; at most 10 in 24 hours for each person) */
    reqCount(sid) {
      const c = D.reqN[sid], t = now();
      if (!c || t > c.t0 + TCE.DAY) { D.reqN[sid] = { n: 1, t0: t }; return; }
      if (c.n >= 10) throw errCode('too-many', 'That’s 10 requests in a day. Tell a manager in person.');
      c.n++;
    },
    async reqSend(sid, ps, note) {
      await wait(200);
      if (!forDev(sid) || !onClock(sid) || !pinOk(sid, 10)) deny();
      B.reqCount(sid);
      const r = { id: 'r' + hexId(12), sid, ps: ps.map(p => ({ k: p.k, t: Math.round(p.t) })), note: note || '', src: lap() ? 'laptop' : 'kiosk', by: D.kiosk.uid, at: now(), st: 'open' };
      D.reqs.push(r); later(); return { id: r.id };
    },
    async reqSendMine(ps, note) {
      await wait(200);
      const sid = mySid(); if (!sid || !onClock(sid)) deny();
      B.reqCount(sid);
      const r = { id: 'r' + hexId(12), sid, ps: ps.map(p => ({ k: p.k, t: Math.round(p.t) })), note: note || '', src: 'me', by: D.me.uid, at: now(), st: 'open' };
      D.reqs.push(r); later(); return { id: r.id };
    },
    async reqTakeBack(id, atKiosk) {
      await wait(150);
      const r = D.reqs.find(x => x.id === id); if (!r || r.st !== 'open') deny();
      if (atKiosk) { if (!forDev(r.sid) || !pinOk(r.sid, 10)) deny(); }
      else if (r.sid !== mySid()) deny();
      r.st = 'x'; r.rat = now(); later();
    },
    async reqAnswer(q, ok, ps, why, note) {
      await wait(180); B.fixOk(q.sid);
      const r = D.reqs.find(x => x.id === q.id); if (!r || r.st !== 'open') deny();
      const fx = [];
      if (ok) ps.forEach(p => { const id = 'f' + hexId(12); fx.push(id); D.fixes.push({ id, sid: r.sid, op: 'add', ref: '', kind: p.k, t: Math.round(p.t), why, by: D.me.uid, bsid: mySid(), at: now() }); });
      Object.assign(r, { st: ok ? 'ok' : 'no', rby: D.me.uid, rbsid: mySid(), rat: now(), rwhy: note || '', fx }); later();
    },
    /* on their own phone or computer: only with the office lock on, on the office network, under the punch number the
       office check just gave (as the rules) */
    async punchOwn(kind, pid) {
      await wait(200);
      const sid = mySid();
      if (!sid || !onClock(sid) || !D.set.lock || !atOffice(D.me.uid, pid)) deny();
      const p = { id: pid, sid, kind, at: now(), src: 'own', net: 'office', by: D.me.uid };
      D.punches.push(p); later(); return { id: p.id, at: p.at };
    },
    async setupOffice() { if (!isOwner()) deny(); },
    async saveStaff(sid, f, cur) {
      await wait(150); if (!isOwner()) deny();
      D.staff[sid] = { on: !!f.on, home: !!f.home, hdays: f.hdays || [], early: f.early || '', cap: f.sal ? 0 : Number(f.cap) || 0, sal: !!f.sal, pinBy: (cur && cur.pinBy) || '', pinAt: cur && cur.pinAt ? B.tsMs(cur.pinAt) || cur.pinAt : null, at: now(), by: D.me.uid };
      later();
    },
    async setPin(sid, pin) { await wait(150); if (!D.mgr || !D.staff[sid]) deny(); D.pins[sid] = pin; D.staff[sid].pinAt = now(); D.staff[sid].pinBy = 'mgr'; later(); },
    async setMgr(sid, on) { await wait(120); if (!isOwner()) deny(); D.mgrs = D.mgrs.filter(x => x !== sid).concat(on ? [sid] : []); later(); },
    async clearTry(sid) { await wait(100); if (!D.mgr) deny(); D.tries[sid] = { n: 0, t0: now(), at: now(), ok: false, k: '' }; later(); },
    fixOk(sid) { if (!D.mgr || (sid === mySid() && !isOwner())) deny(); },
    async fixAdd(sid, kind, t, why) { await wait(150); B.fixOk(sid); D.fixes.push({ id: 'f' + hexId(12), sid, op: 'add', ref: '', kind, t: Math.round(t), why, by: D.me.uid, bsid: mySid(), at: now() }); later(); },
    async fixVoid(sid, ref, why) { await wait(150); B.fixOk(sid); D.fixes.push({ id: 'f' + hexId(12), sid, op: 'void', ref, kind: '', t: 0, why, by: D.me.uid, bsid: mySid(), at: now() }); later(); },
    async fixMove(sid, ref, kind, t, why) {
      await wait(150); B.fixOk(sid);
      D.fixes.push({ id: 'f' + hexId(12), sid, op: 'void', ref, kind: '', t: 0, why, by: D.me.uid, bsid: mySid(), at: now() });
      D.fixes.push({ id: 'f' + hexId(12), sid, op: 'add', ref: '', kind, t: Math.round(t), why, by: D.me.uid, bsid: mySid(), at: now() }); later();
    },
    async setOT(sid, week, hrs, why) { await wait(120); B.fixOk(sid); D.ot = D.ot.filter(x => x.id !== sid + '_' + week); D.ot.push({ id: sid + '_' + week, sid, week, hrs: Number(hrs), why: why || '', by: D.me.uid, bsid: mySid(), at: now() }); later(); },
    async delOT(sid, week) { await wait(120); B.fixOk(sid); D.ot = D.ot.filter(x => x.id !== sid + '_' + week); later(); },
    async saveSettings(o) { await wait(150); if (!isOwner()) deny(); D.set = Object.assign({}, o, { lock: !!o.lock, wurl: o.wurl || '', at: now() }); later(); },
    async saveAlerts(o) { await wait(150); if (!isOwner()) deny(); D.alerts = Object.assign({}, D.alerts, o, { at: now() }); later(); },
    async testAlert() { await wait(150); if (!isOwner()) deny(); D.alerts.test = now(); later(); },
    async makeBot() { await wait(200); if (!isOwner()) deny(); return { email: 'tc-alerts-demo@example.com', password: 'demo-only', uid: 'b_demo' }; },
    async hasBot() { return true; },
    async renameKiosk(uid, name) { if (!isOwner()) deny(); const k = D.kiosks.find(x => x.id === uid); if (k) k.name = name; later(); },
    async removeKiosk(uid) { if (!isOwner()) deny(); D.kiosks = D.kiosks.filter(x => x.id !== uid); later(); },
    scriptConfig() { return { apiKey: 'demo', projectId: 'demo', botEmail: 'tc-alerts-demo@example.com', botPassword: 'demo-only', appUrl: APP_URL }; }
  };
  return B;
})();
