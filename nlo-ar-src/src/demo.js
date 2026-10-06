/* =====================================================================
   Demo backend: made-up accounts, everything in memory, nothing saved.
   Opened with ?demo. Every name and number here is invented (555-01xx
   numbers don't belong to anyone); the amounts follow the same patterns
   as an Edge A/R Aging report so every list has something in it.
   ===================================================================== */
const DEMO = {
  uid: null, me: null, h: null, pending: 0, ar: { curV: 1 }, practice: '',
  reports: [], items: new Map(), logs: [], versions: {}, roster: [], members: [], grants: [], settings: { idleMin: 30 },
  isOwner() { return !!(DEMO.me && DEMO.me.role === 'owner'); },
  isPerm() { return false; },
  copy(x) { return JSON.parse(JSON.stringify(x)); },
  wait(ms) { return new Promise(r => setTimeout(r, ms)); },
  clean(d) { const o = Object.assign({}, d); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'createdAtSrv', 'locked'].forEach(k => delete o[k]); return o; },

  /* ---------- sign in (always the owner, so every screen can be seen) ---------- */
  async signIn() {
    // practice mode for the new-user tour (tour.js, ?demo&tour=staff): signed in as an ordinary staff member, so it looks like their screens
    DEMO.me = DEMO.practice === 'staff' ? { uid: 'u-practice', staffId: 'practice', name: 'Practice User', role: 'staff', active: true, username: 'practice' }
      : { uid: 'u-amir', staffId: 'amir', name: 'Dr. Akhavan', role: 'owner', active: true, email: 'owner@example.com' };
    DEMO.uid = DEMO.me.uid;
    if (!DEMO.reports.length) await DEMO.seed();
    return { state: 'ok' };
  },
  async signOut() { DEMO.h = null; },
  stop() { },
  async firstSetup() { }, async recover() { }, async sendReset() { }, async changePassword() { await DEMO.wait(300); },

  /* ---------- the A/R key ---------- */
  async arOpen() { return 'ok'; },
  async arSetup() { }, async arRestore() { },
  async arPeople() { await DEMO.wait(150); return { grants: DEMO.grants.map(DEMO.copy), members: DEMO.members.map(DEMO.copy), escrowOk: true, hasRecovery: true }; },
  teamSids() { return Array.from(new Set(DEMO.grants.map(g => g.sid))); },
  async arGrant(m) {
    if (!m.pub || !m.active) throw errCode('no-pub', (m.name || 'They') + ' needs to sign in once (and choose a password) first.');
    await DEMO.wait(400);
    DEMO.grants = DEMO.grants.filter(g => g.uid !== m.uid).concat([{ uid: m.uid, sid: m.staffId, pubX: m.pub.x, ringV: DEMO.ar.curV }]);
    if (DEMO.h) DEMO.h.team(DEMO.teamSids());
  },
  async arRevoke(uid, progress) {
    await DEMO.wait(200);
    DEMO.grants = DEMO.grants.filter(g => g.uid !== uid);
    if (DEMO.h) DEMO.h.team(DEMO.teamSids());
    return DEMO.arRotate(progress);
  },
  async arRotate(progress) {
    const tot = DEMO.reports.length + DEMO.items.size;
    for (let n = 1; n <= tot; n++) { await DEMO.wait(30); if (progress) progress(n, tot); }
    DEMO.ar.curV++; DEMO.grants.forEach(g => { g.ringV = DEMO.ar.curV; });
    return { reports: DEMO.reports.length, items: DEMO.items.size, failed: 0 };
  },
  async arReseal() { return { reports: 0, items: 0, failed: 0 }; },
  async arFixGrants() { await DEMO.wait(200); return { removed: [], relogin: [], resealed: [] }; },
  async arReload() { },

  /* ---------- live data ---------- */
  repList() {
    return DEMO.reports.map(r => DEMO.copy(r.meta)).sort((a, b) => (b.asOf > a.asOf ? 1 : b.asOf < a.asOf ? -1 : (b.at || 0) - (a.at || 0)));
  },
  start(h) {
    DEMO.h = h;
    h.settings(DEMO.copy(DEMO.settings)); h.roster(DEMO.roster.map(DEMO.copy)); h.team(DEMO.teamSids());
    h.reports(DEMO.repList());
    h.items(Array.from(DEMO.items.values()).map(DEMO.copy), [], false);
  },
  async loadReport(id) { await DEMO.wait(60); const r = DEMO.reports.find(x => x.meta.id === id); if (!r) throw errCode('gone'); return DEMO.copy(r.data); },
  async saveReport(rep, totals) {
    await DEMO.wait(500);
    const id = 'r' + uid8();
    DEMO.reports.push({ meta: { id, asOf: rep.asOf, n: rep.rows.length, at: Date.now(), by: DEMO.uid, sid: DEMO.me.staffId, v: DEMO.ar.curV, sum: DEMO.copy(totals), locked: false }, data: DEMO.copy(rep) });
    if (DEMO.h) DEMO.h.reports(DEMO.repList());
    return id;
  },
  async deleteReport(id) { await DEMO.wait(200); DEMO.reports = DEMO.reports.filter(r => r.meta.id !== id); if (DEMO.h) DEMO.h.reports(DEMO.repList()); },

  /* ---------- worked accounts ---------- */
  async itemId(key) { return 'a' + (await Crypto.sha256hex('demo|' + key)).slice(0, 22); },
  async getItem(id) { const it = DEMO.items.get(id); return it ? DEMO.copy(it) : null; },
  async loadDone(days) { const since = Date.now() - days * 86400000; return Array.from(DEMO.items.values()).filter(it => it.state === 'done' && (it.updatedAt || 0) >= since).map(DEMO.copy); },
  async mutateItem(id, fn, action, base) {
    await DEMO.wait(80);
    const cur = DEMO.items.get(id); let data, rev;
    if (!cur) { if (!base) throw errCode('gone'); data = DEMO.clean(DEMO.copy(base)); fn(data); rev = 1; }
    else {
      data = DEMO.clean(DEMO.copy(cur)); fn(data); rev = cur.rev + 1;
      (DEMO.versions[id] = DEMO.versions[id] || []).push({ rev: cur.rev, replacedAt: Date.now(), replacedBy: DEMO.me.staffId, replacedHow: action && action.a, data: DEMO.clean(DEMO.copy(cur)) });
    }
    const next = Object.assign(data, { id, rev, v: DEMO.ar.curV, status: data.state === 'done' ? 'done' : 'open', by: DEMO.me.staffId, updatedAt: Date.now() });
    DEMO.items.set(id, next);
    DEMO.logs.push(Object.assign({ itemId: id, rev, at: Date.now(), sid: DEMO.me.staffId }, action || { a: cur ? 'save' : 'create' }));
    if (DEMO.h) DEMO.h.items([DEMO.copy(next)], [], false);
  },
  async itemLog(id) { await DEMO.wait(40); return DEMO.logs.filter(x => x.itemId === id).map(DEMO.copy).sort((a, b) => (a.rev || 0) - (b.rev || 0)); },
  async itemVersions(id) { return (DEMO.versions[id] || []).slice().reverse().map(DEMO.copy); },
  async restoreVersion(id, data) { const keep = DEMO.clean(data); return DEMO.mutateItem(id, d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, keep); }, { a: 'restore' }); },
  async activity(days) { await DEMO.wait(120); const since = Date.now() - days * 86400000; return DEMO.logs.filter(x => x.at >= since).map(DEMO.copy).sort((a, b) => b.at - a.at); },
  async saveSettings(p) { await DEMO.wait(150); Object.assign(DEMO.settings, DEMO.copy(p)); if (DEMO.h) DEMO.h.settings(DEMO.copy(DEMO.settings)); },

  /* =====================================================================
     The made-up office: six weekly reports and a few accounts being worked
     ===================================================================== */
  async seed() {
    let s = 20260920; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    DEMO.roster = [
      { sid: 'amir', name: 'Dr. Akhavan', initials: 'DA', role: 'owner', active: true },
      { sid: 'jamie', name: 'Jamie (demo)', initials: 'J', role: 'staff', active: true, username: 'jamie' },
      { sid: 'taylor', name: 'Taylor (demo)', initials: 'T', role: 'staff', active: true, username: 'taylor' },
      { sid: 'morgan', name: 'Morgan (demo)', initials: 'M', role: 'staff', active: true, username: 'morgan' },
      { sid: 'casey', name: 'Casey (demo)', initials: 'C', role: 'staff', active: true, username: 'casey' }
    ];
    if (DEMO.practice === 'staff') DEMO.roster.push({ sid: 'practice', name: 'Practice User', initials: 'PU', role: 'staff', active: true, username: 'practice' });
    const fakeX = sid => (sid + 'demokeydemokeydemokeydemokeydemokeydemokey').slice(0, 43);
    DEMO.members = DEMO.roster.map(r => Object.assign({ uid: 'u-' + r.sid, staffId: r.sid, name: r.name, role: r.role, active: true, username: r.username || '' },
      r.sid === 'casey' ? { mustSetup: true } : { pub: { kty: 'EC', crv: 'P-256', x: fakeX(r.sid), y: fakeX('y' + r.sid) } }));
    DEMO.grants = ['amir', 'jamie', 'taylor'].concat(DEMO.practice === 'staff' ? ['practice'] : []).map(sid => ({ uid: 'u-' + sid, sid, pubX: fakeX(sid), ringV: 1 }));
    DEMO.settings = { idleMin: 30 };
    const cfg = arCfg(DEMO.settings);

    // the newest report is from the last office day (Mon–Thu); the others a week apart before it
    let latest = todayISO();
    for (let i = 0; i < 7; i++) { const [y, m, d] = latest.split('-').map(Number); if (OFFICE_DAYS.includes(new Date(y, m - 1, d).getDay())) break; latest = addDays(latest, -1); }
    const W = 6, asOfW = w => addDays(latest, -7 * (W - 1 - w));
    const atDay = (iso, h, mi) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, h, mi || 0).getTime(); };

    const FIRST = ['Avery', 'Riley', 'Quinn', 'Harper', 'Rowan', 'Skyler', 'Finley', 'Parker', 'Emerson', 'Sawyer', 'Jordan', 'Dana', 'Reese', 'Logan', 'Blake', 'Peyton', 'Drew', 'Kendall', 'Hayden', 'Dakota', 'Elliot', 'Cameron', 'Ellis', 'Marlow', 'Shay', 'Arden', 'Remy', 'Sage', 'Rory', 'Lane', 'Kai', 'Noel', 'Robin', 'Sasha', 'Toby', 'Wren', 'Milan', 'Tatum', 'Oakley', 'Indigo'];
    const LAST = ['Sample', 'Demo', 'Example', 'Testcase', 'Placeholder', 'Mockley', 'Fakeworth', 'Exampleton', 'Samplesen', 'Demoray', 'Notreal', 'Specimen'];
    const PARENT = ['Jordan', 'Alex', 'Pat', 'Chris', 'Robin', 'Jesse', 'Terry', 'Leslie', 'Kerry', 'Sydney', 'Frankie', 'Lee'];
    const used = new Set();
    const person = () => { let n; do { n = pick(FIRST) + ' ' + pick(LAST); } while (used.has(n)); used.add(n); return n; };
    let phoneN = 0; const phone = () => '(352) 555-01' + String(phoneN++ % 100).padStart(2, '0');
    const PT_STS = ['A-Comp Bra', 'A-Comp Bra', 'A-Comp Bra', 'A-Comp Bra', 'A-Comp Inv', 'A-Comp NLA', 'A- Ph I Br', 'A- Ph II B', 'Retention'];

    // accounts as they are in the newest report (days past due), and the weeks they're in a report at all
    const A = [];
    const add = (o) => { const pat = person(), last = pat.split(' ')[1]; A.push(Object.assign({ patient: pat, rpName: (rnd() < 0.15 ? 'Mr. ' : rnd() < 0.15 ? 'Mrs. ' : '') + pick(PARENT) + ' ' + last, home: phone(), work: rnd() < 0.08 ? phone() : '', from: 0, to: W - 1, note: '' }, o)); };
    // patients: 91+, 31–90, 0–30 (some written-off-sized), one inactive
    [420, 310, 255, 214, 188, 172, 160, 151, 139, 128, 117, 109, 101, 96].forEach((d, i) => add({ src: 'pt', days: d, m: pick([150, 175, 199, 225, 250, 275, 300]), sts: i % 6 === 5 ? 'Inactive' : pick(PT_STS), rem: int(3, 20) }));
    [131, 97].forEach(d => add({ src: 'pt', days: d, m: pick([35, 45]), sts: 'Retention', rem: int(1, 4) }));
    [88, 82, 75, 69, 64, 58, 51, 47, 43, 38, 36].forEach(d => add({ src: 'pt', days: d, m: pick([150, 175, 199, 225, 250, 300]), sts: pick(PT_STS), rem: int(6, 22) }));
    [27, 24, 21, 18, 15, 12, 9, 6, 4].forEach((d, i) => add({ src: 'pt', days: d, m: pick([150, 175, 199, 225, 250]), sts: pick(PT_STS), rem: int(8, 24), note: i % 3 === 0 ? 'Payment in process' : i === 4 ? 'Autopay — card expired' : '' }));
    // insurance where nothing has been paid (past due = N × the instalment): monitor, chase now, investigate, never filed
    [33, 47, 58, 66, 79, 93, 112, 141, 186, 233, 301, 395, 488, 612].forEach(d => add({ src: 'ins', days: d, m: cfg.inst, sts: pick(PT_STS), rem: int(14, 26), never: true }));
    // insurance partly paid (an unpaid claim on top of the instalments)
    [104, 72, 150].forEach(d => add({ src: 'ins', days: d, m: cfg.inst, extra: pick([125, 180, 240, 310]), sts: pick(PT_STS), rem: int(10, 24) }));
    // paid since an earlier report (so "Since the last report" has something to show)
    [[94, 3], [61, 4], [40, 4], [118, 4], [26, 3]].forEach(([d, to], i) => add({ src: i === 3 ? 'ins' : 'pt', days: d, m: i === 3 ? cfg.inst : pick([150, 199, 250]), sts: pick(PT_STS), rem: int(6, 18), to, never: i === 3 }));
    // credit balances: [credit, days since the last payment, status, first week, last week, insurance?]
    [[85, 40, 'A-Comp Bra'], [240, 1290, 'Inactive'], [1150, 1460, 'Inactive'], [62.5, 410, 'Retention'], [310, 220, 'Inactive'], [37.75, 65, 'A-Comp Inv'],
      [450, 18, 'Start Sche'], [900, 33, 'Start Sche'], [128, 820, 'RET ONLY'], [199, 12, 'A-Comp Bra', 5], [75, 30, 'A-Comp NLA', 4], [260, 150, 'A-Comp Bra', 0, 4], [44.44, 95, 'A-Comp Bra', 0, 5, true], [512, 1180, 'Inactive', 0, 5, true]]
      .forEach(([amt, age, sts, from, to, ins]) => add({ src: ins ? 'ins' : 'pt', credit: amt, age, sts, from: from || 0, to: to == null ? W - 1 : to }));

    const rowAt = (a, w) => {
      if (w < a.from || w > a.to) return null;
      const asOf = asOfW(w), back = 7 * (W - 1 - w), rp = (a.src === 'ins' ? 'INS: ' : '') + a.rpName;
      const base = { patient: a.patient, sts: a.sts, rp, home: a.home, work: a.work, note: '' };
      if (a.credit) return Object.assign(base, { due: -a.credit, b0: 0, b30: 0, b60: 0, b90: 0, days: 0, bal: -a.credit, lastAmt: round2(a.credit + (a.src === 'ins' ? 0 : 150)), recv: addDays(latest, -a.age) });
      const d = a.days - back; if (d <= 0) return null;
      // one instalment missed every 30 days; an unpaid claim (partly paid insurance) sits in the oldest bucket
      const n = Math.ceil(d / 30), m = a.m, x = a.extra || 0;
      const bk = [m, n >= 2 ? m : 0, n >= 3 ? m : 0, n > 3 ? (n - 3) * m : 0];
      if (x) bk[d > 90 ? 3 : d > 60 ? 2 : d > 30 ? 1 : 0] += x;
      const [b0, b30, b60, b90] = bk.map(round2), due = round2(b0 + b30 + b60 + b90), bal = round2(due + m * a.rem);
      return Object.assign(base, { due, b0, b30, b60, b90, days: d, bal, lastAmt: a.never ? 0 : m, recv: a.never ? '' : addDays(asOf, -(d + 3)), note: w === W - 1 ? a.note : '' });
    };
    for (let w = 0; w < W; w++) {
      const asOf = asOfW(w), rows = A.map(a => rowAt(a, w)).filter(Boolean).map(r => Object.assign(r, { key: acctKey(r) }));
      const pt = rows.filter(r => !isIns(r)), ins = rows.filter(isIns), sum = (l, k) => round2(l.reduce((t, r) => t + (Number(r[k]) || 0), 0));
      // the accounts that are paid up (not in the saved rows) add to the book's totals; act = not Inactive (the goals' "active accounts")
      const act = l => l.filter(r => !isInactive(r)).length;
      const book = { n: rows.length + 560 + w, bal: round2(sum(rows, 'bal') + 1201250 - w * 1830), due: sum(rows, 'due'), pt: { n: pt.length + 380, bal: round2(sum(pt, 'bal') + 919400 - w * 1400), act: act(pt) + 380 }, ins: { n: ins.length + 180 + w, bal: round2(sum(ins, 'bal') + 281850 - w * 430), act: act(ins) + 180 + w } };
      const rep = { asOf, cover: { full: true, pastDue: true, credit: true, ins: true }, book, rows, files: [{ name: 'AR Aging ' + asOf + '.xls', kind: 'xls', subgroup: '', options: 'Exclude Zero Dollar Balances', edge: 'Edge', n: rows.length + 560, ok: true }], made: atDay(asOf, 8, 40) };
      DEMO.reports.push({ meta: { id: 'demo-r' + w, asOf, n: rows.length, at: Math.min(Date.now() - 40 * 60000, atDay(asOf, 8, 52 + w)), by: 'u-jamie', sid: 'jamie', v: 1, sum: reportTotals(rep, cfg), locked: false }, data: rep });
    }

    /* accounts being worked — logged the way the app logs them */
    const latestRep = DEMO.reports[W - 1].data, prevRep = DEMO.reports[W - 2].data;
    const accts = reportAccts(latestRep, cfg), byKey = new Map(accts.map(a => [a.key, a]));
    const l91 = list91(accts), never = listNever(accts), credits = listCredits(accts);
    const now = Date.now(), ago = (days, h, mi) => Math.min(now - 25 * 60000, atDay(addDays(todayISO(), -days), h, mi || 0));
    const worked = new Set();
    const make = async (a, by, steps, after) => {
      if (!a) return;
      worked.add(a.key);
      const it = Object.assign(blankItem(a), { createdAt: steps.length ? steps[0][1] : now, createdBy: by, assignee: by });
      const id = await DEMO.itemId(a.key); let rev = 0;
      for (const [k, at, who, o] of steps) {
        let act = { a: 'log', k };
        if (k === 'done') { resolveItem(it, o.outcome, { by: who, note: o.note || '' }, at); act = { a: 'resolve', outcome: o.outcome }; }
        else if (k === 'drA') { it.log.push({ id: uid8(), at, by: who, k: 'drA_ask', note: o.q, prev: { stage: it.stage, follow: it.follow, drA: !!it.drA } }); it.drA = true; act = { a: 'drA' }; }
        // the collections ladder: a step sent, a letter for Dr. A to sign / signed, Maintenance Hold, a broken arrangement
        else if (k === 'lad') { ladderLog(it, o.step, { by: who, note: o.note || '' }, at); act = { a: 'ladder', step: o.step }; }
        else if (k === 'ask') { askSign(it, o.step, { by: who }, at); act = { a: 'drA', step: o.step }; }
        else if (k === 'sign') { signStep(it, o.step, { by: who }, at); act = { a: 'drAok', step: o.step }; }
        else if (k === 'hold') { holdLog(it, o.on !== false, { by: who }, at); act = { a: 'mhold', on: o.on !== false }; }
        else if (k === 'aa') { breakArrangement(it, { by: who, note: o && o.note || '' }, at); act = { a: 'aa' }; }
        else applyLog(it, k, Object.assign({ by: who }, o || {}), at);
        rev++; DEMO.logs.push(Object.assign({ itemId: id, rev, at, sid: who }, act));
      }
      if (after) after(it);
      const last = steps.length ? steps[steps.length - 1][1] : now;
      DEMO.items.set(id, Object.assign(it, { id, rev, v: 1, status: it.state === 'done' ? 'done' : 'open', by: steps.length ? steps[steps.length - 1][2] : by, updatedAt: last }));
    };
    const t = todayISO();
    // the biggest 91+: voicemails — follow up today
    await make(l91[0], 'jamie', [['pt_noans', ago(9, 10, 5), 'jamie'], ['pt_vm', ago(3, 14, 20), 'jamie', { note: 'Left a message on the home number' }]], it => { it.follow = t; });
    // promised to pay in two office days
    await make(l91[1], 'jamie', [['pt_spoke', ago(2, 11, 40), 'jamie', { note: 'Mom says she can pay $200 now and the rest next month' }], ['pt_promise', ago(2, 11, 42), 'jamie', { date: nextOfficeDay(addDays(t, 2)), amt: 200 }]]);
    // paid in full this morning (still on the report until the next one)
    await make(l91[3], 'jamie', [['pt_spoke', ago(6, 15, 0), 'jamie'], ['done', ago(0, 9, 15), 'jamie', { outcome: 'paid', note: 'Paid by card over the phone' }]]);
    // resolved before this report — but it's past due again in it
    await make(l91[5], 'taylor', [['pt_plan', ago(30, 10, 30), 'taylor', { note: 'Plan: $100 a month on the 1st' }], ['done', ago(29, 10, 35), 'taylor', { outcome: 'other', note: 'On a payment plan' }]]);
    // insurance: chase now — checked the portal, now late
    const chase = never.filter(a => a.tier === 'chase');
    await make(chase[0], 'taylor', [['ins_portal', ago(16, 9, 50), 'taylor', { note: 'No claim on file with the carrier' }]], it => { it.follow = addDays(t, -2); });
    await make(chase[1], 'taylor', [['ins_call', ago(5, 13, 10), 'taylor', { note: 'Carrier needs the treatment start date — sent it' }]]);
    // insurance: investigate — denied, billed to the family
    const inv = never.find(a => a.tier === 'investigate');
    await make(inv, 'taylor', [['ins_denied', ago(12, 11, 0), 'taylor', { note: 'Denied: over the age limit for the ortho benefit' }], ['ins_pt', ago(11, 9, 30), 'taylor', { note: 'Letter to the family explaining the denial' }]]);
    // a credit to refund — waiting for Dr. A
    const old = credits.find(a => a.age > 1095 && !a.prepay);
    await make(old, 'jamie', [['cr_review', ago(6, 10, 0), 'jamie', { note: 'Insurance paid twice in 2023' }], ['drA', ago(1, 16, 5), 'jamie', { q: 'OK to refund ' + money(old ? old.credit : 0, true) + ' to the family by check? Checklist done.' }]],
      it => { it.checks = { fee: true, ins: true, ltm: true, chg: true, rpbal: true, phase: true }; it.stage = 'waiting'; it.follow = nextOfficeDay(addDays(t, 2)); });
    // paid since the last report — still open here, so it shows under "Cleared in Edge"
    const goneKey = reportAccts(prevRep, cfg).find(a => a.pd > 0 && !byKey.has(a.key) && !a.ins);
    await make(goneKey, 'jamie', [['pt_text', ago(8, 12, 0), 'jamie', { note: 'Texted the balance and the payment link' }]]);
    // a 31–90 account with a text sent today
    await make(list31(accts)[2], 'jamie', [['pt_text', ago(0, 9, 5), 'jamie']]);

    /* the collections ladder (handbook §14) — patient accounts at different steps */
    const pt = d => accts.find(a => onLadder(a) && a.days === d && !worked.has(a.key));
    const dNow = a => ladDays(a, latestRep.asOf, t);
    const on = (a, x, h, mi) => ago(Math.max(0, dNow(a) - x), h || 10, mi || 0); // the day the account was x days past due
    const L = (a, x, step, o) => ['lad', on(a, x, 10, 20), 'jamie', Object.assign({ step }, o || {})];
    const seed = async (a, steps) => { if (a) await make(a, 'jamie', steps(a)); };
    // day 47: the first text, letters #1 and #2 went out — #3 and the call are due
    await seed(pt(47), a => [L(a, 1, 'd0'), L(a, 15, 'l1'), L(a, 31, 'l2')]);
    // day 64: up to #3 — Letter #4 (Dr. A signs) and Maintenance Hold are due
    await seed(pt(64), a => [L(a, 15, 'l1'), L(a, 30, 'l2'), L(a, 46, 'l3', { note: 'Spoke with dad — said he’d call back Friday' })]);
    // day 96: on Maintenance Hold since day 61; Letter #5 waiting for Dr. A's signature
    await seed(pt(96), a => [L(a, 14, 'l1'), L(a, 30, 'l2'), L(a, 45, 'l3'), ['ask', on(a, 60, 9), 'jamie', { step: 'l4' }], ['sign', on(a, 60, 16), 'amir', { step: 'l4' }], L(a, 61, 'l4'), ['hold', on(a, 61, 10, 30), 'jamie', {}],
      L(a, 76, 'c75', { note: 'Voicemail; texted' }), ['ask', on(a, 92, 11), 'jamie', { step: 'l5' }]]);
    // day 101: on hold, Letter #5 went certified — #6 (the bridge letter) is due
    await seed(pt(101), a => [L(a, 15, 'l1'), L(a, 31, 'l2'), L(a, 46, 'l3'), ['sign', on(a, 60, 15), 'amir', { step: 'l4' }], L(a, 61, 'l4'), ['hold', on(a, 61, 11), 'jamie', {}],
      L(a, 75, 'c75'), ['sign', on(a, 90, 15), 'amir', { step: 'l5' }], L(a, 91, 'l5', { note: 'Certified #9407 1000 0000 0000 0000 01' })]);
    // day 82: a payment plan (an Alternative Arrangement) at day 78 — paused, still on hold until its first payment
    await seed(pt(82), a => [L(a, 15, 'l1'), L(a, 30, 'l2'), L(a, 45, 'l3'), ['sign', on(a, 60, 15), 'amir', { step: 'l4' }], L(a, 61, 'l4'), ['hold', on(a, 61, 11), 'jamie', {}],
      L(a, 75, 'c75'), ['pt_plan', on(a, 78, 14), 'jamie', { note: 'New contract: $175 on the 15th' }]]);
    // day 69: the arrangement made at day 40 was broken — Letter #8 is due
    await seed(pt(69), a => [L(a, 15, 'l1'), L(a, 31, 'l2'), ['pt_plan', on(a, 40, 11), 'jamie', { note: 'Alternative Arrangement signed' }], ['aa', on(a, 67, 10), 'jamie', { note: 'Second payment bounced' }]]);
    // day 139: Letter #7 went out 18 days ago — in the 30 days for appliance removal and emergencies
    await seed(pt(139), a => [['sign', on(a, 121, 9), 'amir', { step: 'l7' }], L(a, 121, 'l7', { note: 'Certified #9407 1000 0000 0000 0000 02' })]);
    // Letter #7 went out over 30 days ago — time to write it off
    await seed(pt(160) || pt(151) || pt(188), a => [['sign', on(a, a.days - 38, 9), 'amir', { step: 'l7' }], L(a, a.days - 38, 'l7', { note: 'Certified #9407 1000 0000 0000 0000 03' })]);
    // day 15: texted on day 1 — Letter #1 is due
    await seed(pt(15), a => [L(a, 1, 'd0')]);
  }
};
