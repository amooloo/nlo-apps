/* =====================================================================
   Demo backend: made-up leads, everything in memory, nothing saved.
   Opened with ?demo. Every name, number and email here is invented
   (555-01xx numbers and example.com addresses don't belong to anyone).
   ===================================================================== */
const DEMO = {
  me: null, h: null, leads: new Map(), logs: [], roster: [], members: [], curV: 1, pending: 0,
  settings: { idleMin: 30 }, inbox: [], intake: null, secret: '', feedOn: true, stats: null, versions: {}, deleted: [],
  isOwner() { return true; },
  async signIn() {
    DEMO.me = { uid: 'u-amir', staffId: 'amir', name: 'Dr. Akhavan', role: 'owner', active: true };
    if (!DEMO.leads.size) DEMO.seed();
    return { state: 'ok' };
  },
  async signOut() { DEMO.h = null; clearTimeout(DEMO.tmr); },
  stop() { },
  copy(x) { return JSON.parse(JSON.stringify(x)); },
  seed() {
    DEMO.roster = [
      { sid: 'amir', name: 'Dr. Akhavan', initials: 'DA', role: 'owner', active: true },
      { sid: 'savannah', name: 'Savannah (demo)', initials: 'S', role: 'staff', active: true, username: 'savannah' },
      { sid: 'sarah', name: 'Sarah (demo)', initials: 'SA', role: 'staff', active: true, username: 'sarah' },
      { sid: 'gwen', name: 'Gwen (demo)', initials: 'G', role: 'staff', active: true, username: 'gwen' }
    ];
    DEMO.members = DEMO.roster.map(r => ({ uid: 'u-' + r.sid, staffId: r.sid, name: r.name, role: r.role, active: true }));
    DEMO.settings = { idleMin: 30, leads: { feedUrl: 'https://lead-intake-demo-uc.a.run.app' } };
    DEMO.intake = { kid: 'kdemo', at: Date.now() - 20 * 86400e3 }; DEMO.secret = 'demo-' + randChars(20).toLowerCase();
    DEMO.stats = { okAt: Date.now() - 3 * 3600e3 };
    const cfg = leadCfg(DEMO.settings), page = 'https://thenextlevelorthodontics.com/request-an-appointment/';
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    const atDay = (iso, h, m) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(y, mo - 1, d, h, m || 0).getTime(); };
    const now = Date.now();
    // name, parent, phone, email, message, received (days ago, hour), [attempt results], extra
    const plan = [
      ['Avery Sample', 'Jordan Sample', '352-555-0101', 'jordan.sample@example.com', 'My daughter needs a consult for braces. Afternoons are best.', 0, 9, []],
      ['Riley Demo', '', '352-555-0102', 'riley.demo@example.com', 'Interested in clear aligners for myself.', 0, 8, []],
      ['Quinn Example', 'Casey Example', '352-555-0103', '', 'Our dentist referred us.', 1, 14, [['vm']]],
      ['Harper Testcase', 'Morgan Testcase', '352-555-0104', 'morgan.t@example.com', 'Does insurance cover a first visit?', 2, 11, [['none'], ['sent']]],
      ['Rowan Placeholder', '', '', 'rowan.p@example.com', 'Can I get a price for Invisalign?', 3, 16, [['sent']]],
      ['Skyler Mockley', 'Dana Mockley', '352-555-0106', 'dana.m@example.com', '', 8, 10, [['vm'], ['sent'], ['none']]],
      ['Finley Sample', 'Reese Sample', '352-555-0107', 'reese.s@example.com', 'Second opinion on expander.', 9, 15, [['vm'], ['sent'], ['vm'], ['sent']]],
      ['Parker Demo', 'Logan Demo', '352-555-0108', 'logan.d@example.com', 'Moved here from Tampa, mid-treatment.', 6, 9, [['follow', { follow: 1 }]]],
      ['Emerson Example', '', '352-555-0109', 'emerson@example.com', 'Retainer broke, need a new one.', 4, 12, []],
      ['Sawyer Sample', 'Blake Sample', '(352) 555-0110', 'blake.sample@example.com', 'Looking for an appointment next week.', 1, 10, []]
    ];
    let k = 0;
    const mk = (p, closeAfter) => {
      const [name, parent, phone, email, message, ago, hour, results] = p;
      const recv = new Date(day(ago)); recv.setHours(hour, 7 + (k * 13) % 50, 0, 0);
      if (recv.getTime() > now - 20 * 60e3) recv.setTime(now - (20 + k * 9) * 60e3); // "this morning" before the office opened
      const l = Object.assign(blankLead(), { name, parent, phone, email, message });
      l.src = { kind: k % 4 === 3 ? 'manual' : 'website', page: k % 4 === 3 ? '' : page, how: k % 4 === 3 ? 'Phone call' : '' };
      startLead(l, recv.getTime(), cfg); l.assignee = k % 5 === 4 ? 'sarah' : 'savannah'; l.createdAt = recv.getTime() + 5 * 60e3; l.createdBy = k % 4 === 3 ? 'gwen' : 'savannah';
      let status = 'open';
      results.forEach(([res, o], i) => {
        if (curStep(l) < 0) return;
        const j = curStep(l), when = Math.min(now - 3600e3, Math.max(recv.getTime() + (25 + k * 7 % 60) * 60e3, atDay(l.steps[j].due, 10 + (i % 5), 20)));
        const opt = Object.assign({ by: 'savannah' }, o || {});
        if (opt.follow != null) opt.follow = addDays(todayISO(), opt.follow);
        if (res === 'sched') { opt.appt = addDays(todayISO(), 6 + (k % 9)); opt.apptTime = ['09:30', '14:00', '10:15'][k % 3]; }
        const r = applyResult(l, j, res, opt, cfg, when); if (r === 'done') status = 'done';
        if (res === 'sched') { closeLead(l, 'sched'); status = 'done'; }
      });
      if (closeAfter) { closeLead(l, closeAfter); status = 'done'; }
      const id = 'demo' + (k++);
      const lastAt = Math.max(l.createdAt, ...l.steps.filter(s => s.doneAt).map(s => s.doneAt));
      DEMO.leads.set(id, Object.assign(l, { id, rev: 1 + l.steps.filter(s => s.doneAt).length, v: 1, status, by: 'savannah', updatedAt: lastAt, closedAt: status === 'done' ? lastAt : null }));
      DEMO.logs.push({ leadId: id, a: 'create', how: l.src.kind, at: l.createdAt, sid: l.createdBy });
      l.steps.forEach((s, i) => { if (s.doneAt) DEMO.logs.push({ leadId: id, a: 'log', i, res: s.res, at: s.doneAt, sid: s.by || 'savannah' }); });
      return l;
    };
    plan.forEach(p => mk(p));
    // one waiting on a look: same phone number as an earlier lead
    const dup = mk(['Sawyer Sample', 'Blake Sample', '352 555 0110', 'blake.sample@example.com', 'Sent the form twice, sorry!', 0, 7, []]);
    const orig = Array.from(DEMO.leads.values()).find(x => x.name === 'Sawyer Sample' && x !== dup);
    Object.assign(dup, { flag: 'dup', flagWhy: 'Same phone number as Sawyer Sample', dupOf: orig.id });
    const odd = mk(['Buy Followers Now', '', '', 'promo@example.com', 'Cheap followers at www.example.com/promo www.example.com/deal', 1, 3, []]);
    Object.assign(odd, { flag: 'spam', flagWhy: 'Web link in the name · No phone number' });
    // the last two months, for Results and Closed
    const names = ['Jamie', 'Peyton', 'Drew', 'Kendall', 'Hayden', 'Dakota', 'Elliot', 'Taylor', 'Cameron', 'Ellis', 'Marlow', 'Shay', 'Arden', 'Remy'];
    names.forEach((n, i) => {
      const ago = 12 + i * 3, outcome = i % 3 === 0 ? 'none' : i % 3 === 1 ? 'sched' : (i % 2 ? 'no' : 'none');
      const res = outcome === 'sched' ? [['vm'], ['sched']] : outcome === 'no' ? [['vm'], ['no']] : [['none'], ['sent'], ['vm'], ['sent'], ['none']];
      mk([n + ' Sample', i % 2 ? '' : 'Pat Sample', '352-555-01' + String(20 + i), n.toLowerCase() + '@example.com', 'Requesting a consultation.', ago, 9 + (i % 7), res]);
    });
  },
  start(h) {
    DEMO.h = h;
    h.settings(DEMO.copy(DEMO.settings)); h.roster(DEMO.roster.slice()); h.members(DEMO.members.slice());
    h.leads(Array.from(DEMO.leads.values()).filter(l => l.status === 'open').map(DEMO.copy), [], false);
    h.intake(DEMO.intake ? { kid: DEMO.intake.kid, key: true, at: DEMO.intake.at } : null);
    h.inbox(DEMO.inboxList());
    h.mail([]); h.mailRoute({ senders: WEB_SENDERS.slice() });
    // a website request arrives a few seconds after signing in, to show it being filed automatically
    clearTimeout(DEMO.tmr);
    if (!DEMO.arrived) DEMO.tmr = setTimeout(() => { DEMO.arrived = true; DEMO.arrive({ name: 'Morgan Example', parent: 'Alex Example', phone: '352-555-0177', email: 'alex.example@example.com', message: 'Hi! We would like to schedule a free consultation for our son. Mornings work best.' }); }, 6000);
  },
  inboxList() { return DEMO.inbox.map(x => ({ id: x.id, at: x.at, kid: 'kdemo' })); },
  /* what the receiving service would store after reading the website form */
  arrive(f, test) {
    if (!DEMO.feedOn || !DEMO.intake) return;
    const id = 'web' + uid8(), flags = [];
    if (test) flags.push({ k: 'test', why: 'Test request sent from Settings' });
    if (!phoneInfo(f.phone).ok && !validEmail(f.email)) flags.push({ k: 'check', why: 'No working phone number or email' });
    DEMO.inbox.push({ id, at: Date.now(), payload: { v: 1, at: Date.now(), name: f.name || '', parent: f.parent || '', email: f.email || '', phone: f.phone || '', message: f.message || '', extra: {}, page: 'https://thenextlevelorthodontics.com/request-an-appointment/', flags, raw: '', test: !!test } });
    DEMO.stats = { okAt: Date.now() };
    if (DEMO.h) DEMO.h.inbox(DEMO.inboxList());
  },
  emit(l) {
    if (!DEMO.h) return;
    if (l.status === 'open') DEMO.h.leads([DEMO.copy(l)], [], false); else DEMO.h.leads([], [l.id], false);
  },
  canIngest() { return !!DEMO.intake; },
  async openInbox(id) { const x = DEMO.inbox.find(i => i.id === id); if (!x) throw errCode('gone'); return { payload: DEMO.copy(x.payload), at: x.at }; },
  async commitIntake(id, data) {
    if (DEMO.leads.has(id)) throw errCode('permission-denied');
    await new Promise(r => setTimeout(r, 120));
    const l = Object.assign(DEMO.copy(data), { id, rev: 1, v: 1, status: 'open', by: DEMO.me.staffId, updatedAt: Date.now(), closedAt: null });
    DEMO.leads.set(id, l); DEMO.logs.push({ leadId: id, a: 'create', how: 'website', at: Date.now(), sid: DEMO.me.staffId });
    DEMO.inbox = DEMO.inbox.filter(i => i.id !== id);
    DEMO.emit(l); if (DEMO.h) DEMO.h.inbox(DEMO.inboxList());
  },
  async leadExists(id) { return DEMO.leads.has(id); },
  async dismissInbox(id) { DEMO.inbox = DEMO.inbox.filter(i => i.id !== id); if (DEMO.h) DEMO.h.inbox(DEMO.inboxList()); },
  async createLeads(list, progress) {
    const ids = list.map((item, n) => {
      const id = 'demo' + uid8(); const done = item.status === 'done';
      const l = Object.assign(DEMO.copy(item.data), { id, rev: 1, v: 1, status: done ? 'done' : 'open', by: DEMO.me.staffId, updatedAt: Date.now(), closedAt: done ? (item.closedAt || Date.now()) : null });
      DEMO.leads.set(id, l); DEMO.logs.push(Object.assign({ leadId: id, at: Date.now(), sid: DEMO.me.staffId }, item.action || { a: 'create' })); DEMO.emit(l);
      if (progress) progress(n + 1, list.length); return id;
    });
    return ids;
  },
  async createLead(data, action) { return (await DEMO.createLeads([{ data, status: 'open', action }]))[0]; },
  async mutateLead(id, fn, action) {
    const cur = DEMO.leads.get(id); if (!cur) throw errCode('gone');
    await new Promise(r => setTimeout(r, 80));
    const data = DEMO.copy(cur); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'closedAt'].forEach(k => delete data[k]);
    const st = fn(data); const status = st === 'done' || st === 'open' ? st : cur.status;
    (DEMO.versions[id] = DEMO.versions[id] || []).push({ rev: cur.rev, replacedAt: Date.now(), replacedBy: DEMO.me.staffId, replacedHow: action && action.a, data: DEMO.copy(cur) });
    const next = Object.assign(data, { id, rev: cur.rev + 1, v: 1, status, by: DEMO.me.staffId, updatedAt: Date.now(), closedAt: status === 'done' ? (cur.status === 'done' && cur.closedAt ? cur.closedAt : Date.now()) : null });
    DEMO.leads.set(id, next); DEMO.logs.push(Object.assign({ leadId: id, at: Date.now(), sid: DEMO.me.staffId }, action || { a: 'save' }));
    DEMO.emit(next);
  },
  async deleteLead(id) { const l = DEMO.leads.get(id); if (!l) throw errCode('gone'); DEMO.deleted.push({ leadId: id, at: Date.now(), sid: DEMO.me.staffId, data: DEMO.copy(l) }); DEMO.leads.delete(id); if (DEMO.h) DEMO.h.leads([], [id], false); },
  async loadClosed(days) { const since = Date.now() - days * 86400e3; return Array.from(DEMO.leads.values()).filter(l => l.status === 'done' && (l.closedAt || 0) >= since).map(DEMO.copy); },
  async loadAll() { return Array.from(DEMO.leads.values()).map(DEMO.copy); },
  async leadLog(id) { return DEMO.logs.filter(x => x.leadId === id).slice().sort((a, b) => a.at - b.at); },
  async activity(days) { const since = Date.now() - days * 86400e3; return DEMO.logs.filter(x => x.at >= since).slice().sort((a, b) => b.at - a.at).slice(0, 80); },
  async leadVersions(id) { return (DEMO.versions[id] || []).slice().reverse(); },
  async restoreVersion(id, data) { const keep = DEMO.copy(data); return DEMO.mutateLead(id, d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, keep); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'closedAt'].forEach(k => delete d[k]); return keep.closeWhy ? 'done' : 'open'; }, { a: 'restore' }); },
  async deletedLeads() { return DEMO.deleted.slice().reverse(); },
  async undelete(item) { DEMO.deleted = DEMO.deleted.filter(x => x !== item); return DEMO.createLeads([{ data: item.data, status: item.data.closeWhy ? 'done' : 'open', action: { a: 'restore' } }]); },
  async saveSettings(p) { Object.assign(DEMO.settings, DEMO.copy(p)); if (DEMO.h) DEMO.h.settings(DEMO.copy(DEMO.settings)); },
  /* website feed */
  async setupIntake() { if (DEMO.intake) throw errCode('exists', 'The website feed is already set up.'); DEMO.intake = { kid: 'kdemo', at: Date.now() }; DEMO.secret = 'demo-' + randChars(20).toLowerCase(); DEMO.feedOn = true; if (DEMO.h) DEMO.h.intake({ kid: 'kdemo', key: true, at: Date.now() }); return DEMO.secret; },
  async intakeSecretDoc() { return DEMO.intake ? { on: DEMO.feedOn, at: DEMO.intake.at } : null; },
  async readSecret() { return DEMO.secret || null; },
  async rotateSecret() { DEMO.secret = 'demo-' + randChars(20).toLowerCase(); return DEMO.secret; },
  async setFeedOn(on) { DEMO.feedOn = !!on; },
  async intakeStats() { return DEMO.stats; },
  /* the "Send a test request" button: in the demo the request arrives without leaving the page */
  async sendTest() { setTimeout(() => DEMO.arrive({ name: 'Test Request', parent: '', phone: '352-555-0199', email: 'test@example.com', message: 'Test request sent from NLO Leads settings.' }, true), 1500); },
  /* website requests by email: in the demo they arrive through the instant feed above */
  async openMail() { throw errCode('gone'); },
  async commitMailLead() { throw errCode('gone'); },
  async leadUsed(id) { return DEMO.leads.has(id); },
  async dropMail() { },
  async addMailSender() { },
  async mailBeats() { return [{ box: 'office@example.com', at: Date.now() - 4 * 60000, err: '' }, { box: 'records@example.com', at: Date.now() - 7 * 60000, err: '' }]; },
  async resealAll() { return { leads: 0, failed: 0, intake: false }; },
  async oldCount() { return 0; },
  async changePassword() { }
};
