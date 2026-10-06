/* =====================================================================
   Demo backend: made-up patients, everything in memory, nothing saved.
   Opened with ?demo — lets the office try the app before Firebase exists.
   ===================================================================== */
const DEMO = {
  me: null, h: null, cases: new Map(), logs: [], roster: [], members: [], curV: 1,
  // (indexed — patient history loads by patient — and backed up three days ago, so Today doesn't ask for a backup)
  settings: { idleMin: 30, alPerAligner: 4.5, pidx: 1, lastBackup: { at: Date.now() - 3 * 864e5, by: 'amir', cases: 37 } },
  isOwner() { return !DEMO.me || DEMO.me.role === 'owner'; },
  async emailFor(l) { return l; },
  async signIn() {
    // practice mode for the new-user tour (tour.js, ?demo&tour=staff): signed in as an ordinary staff member, so it looks like their screens
    DEMO.me = DEMO.practice === 'staff' ? { uid: 'u-practice', staffId: 'practice', name: 'Practice User', role: 'staff', active: true }
      : { uid: 'u-amir', staffId: 'amir', name: 'Dr. Akhavan', role: 'owner', active: true };
    if (!DEMO.cases.size) DEMO.seed();
    return { state: 'ok' };
  },
  async signOut() { DEMO.h = null; },
  stop() { },
  seed() {
    DEMO.roster = [
      { sid: 'amir', name: 'Dr. Akhavan', initials: 'DA', role: 'owner', active: true, username: '' },
      { sid: 'sarah', name: 'Sarah (demo)', initials: 'S', role: 'staff', active: true, username: 'sarah' },
      { sid: 'angelika', name: 'Angelika (demo)', initials: 'A', role: 'staff', active: true, username: 'angelika' },
      { sid: 'gwen', name: 'Gwen (demo)', initials: 'G', role: 'staff', active: true, username: 'gwen' },
      { sid: 'kaylee', name: 'Kaylee (demo)', initials: 'K', role: 'staff', active: true, username: 'kaylee' }
    ];
    if (DEMO.practice === 'staff') DEMO.roster.push({ sid: 'practice', name: 'Practice User', initials: 'PU', role: 'staff', active: true, username: 'practice' });
    DEMO.members = DEMO.roster.map((r, i) => ({ uid: 'u-' + r.sid, staffId: r.sid, name: r.name, username: r.username, role: r.role, active: true, mustSetup: i === 4, lastLogin: { toMillis: () => Date.now() - i * 3600e3 } }));
    const first = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Taylor', 'Quinn', 'Rowan', 'Skyler', 'Harper', 'Emerson', 'Finley', 'Parker', 'Reese', 'Sawyer', 'Hayden', 'Dakota', 'Elliot', 'Blake', 'Jamie', 'Logan', 'Peyton', 'Drew', 'Kendall'];
    const last = ['Sample', 'Demo', 'Testcase', 'Example', 'Placeholder', 'Mockley'];
    const t = todayISO();
    const plan = [
      ['oliv', 'submit', 'sarah', 9], ['oliv', 'dra', 'amir', 2], ['oliv', 'mfg', 'sarah', 12], ['oliv', 'shipped', 'sarah', 4], ['oliv', 'arrived', 'sarah', -1],
      ['angel', 'mfg', 'sarah', 6], ['ulab', 'submit', 'gwen', 1], ['insmile', 'dra', 'amir', 5], ['invisalign', 'milestones', 'sarah', 0],
      ['nla', 'txp', 'amir', -2], ['nla', 'txp', 'amir', 3], ['nla', 'txp', 'angelika', 2], ['nla', 'thermo', 'angelika', 6], ['nla', 'send', 'kaylee', 8], ['nla', 'pack', 'gwen', 1],
      ['appliance', 'submit', 'sarah', 7], ['appliance', 'hold', 'amir', null], ['appliance', 'mfg', 'sarah', 15],
      ['retainer', 'print', 'angelika', 1], ['retainer', 'print', 'gwen', null], ['retainer', 'milestones', 'sarah', 0], ['retainer', 'pickup', 'sarah', -3],
      ['ulab', 'mfg', 'gwen', 10], ['models', 'print', 'kaylee', 4], ['mouthguard', 'print', 'kaylee', 2], ['insmile', 'mfg', 'sarah', 9],
      ['marpe', 'records', 'sarah', null], ['marpe', 'zoom', 'amir', 16], ['marpe', 'approved', 'sarah', 12]
    ];
    const details = { oliv: 'Aligners (Oliv)', angel: 'Aligners (Angel)', ulab: 'Aligners (uLab)', invisalign: 'Aligners (Invisalign)', nla: 'Aligners (In-House)', appliance: 'Herbst', retainer: "U/L TT's and WT's", models: 'Study models', mouthguard: 'Mouthguard (U)', insmile: 'InSmile braces', marpe: 'MARPE' };
    plan.forEach((p, i) => {
      const [type, stage, who, due] = p; const id = 'demo' + i;
      const scan = addDays(t, -10 + (i % 7));
      DEMO.cases.set(id, {
        id, rev: 1, v: 1, status: 'open', by: 'amir', updatedAt: Date.now() - i * 3600e3, closedAt: null,
        type, patient: first[i % first.length] + ' ' + last[i % last.length], detail: details[type], stage, assignee: who,
        scanDate: TYPE[type].aligner ? scan : '', labDate: TYPE[type].aligner && due != null ? addDays(t, due) : '', deliveryDate: due == null ? '' : addDays(t, due + (TYPE[type].aligner ? 7 : 0)), deliveryTime: due == null || i % 4 === 3 ? '' : ['09:00', '10:30', '14:00'][i % 4],
        alU: type === 'nla' ? [18, 22, 14, 26, 20, 12][i % 6] : '', alL: type === 'nla' ? [16, 22, 14, 20, 20, 12][i % 6] : '', initial: type === 'nla' ? 'yes' : '',
        scanner: TYPE[type].aligner ? 'Allied Star' : '', assistant: ['angelika', 'gwen', 'kaylee'][i % 3],
        instructions: TYPE[type].aligner ? 'Close remaining spaces, improve bite.' : '', cc: '', ipr: i % 3 === 0 ? 'UR2–UR1 0.1mm, UR1–UL1 0.1mm' : '', notes: '',
        comments: i % 4 === 0 ? [{ id: 'c' + i, at: Date.now() - 7200e3, by: 'sarah', text: 'Submitted in the portal.' }] : [], createdAt: Date.now() - 86400e3 * (i + 2), createdBy: 'amir'
      });
      DEMO.logs.push({ caseId: id, a: 'create', at: Date.now() - 86400e3 * (i + 2), sid: 'amir' });
    });
    // MARPE: one still waiting on its CBCT, one with the Zoom call in two days, one approved; Partners makes them
    const all = Array.from(DEMO.cases.values()), mp = all.filter(c => c.type === 'marpe');
    Object.assign(mp[0], { records: ['stl'], lab: 'Partners Dental Solutions' });
    Object.assign(mp[1], { records: ['stl', 'cbct'], lab: 'Partners Dental Solutions', zoomDate: addDays(t, 2), zoomTime: '12:30' });
    Object.assign(mp[2], { records: ['stl', 'cbct'], lab: 'Partners Dental Solutions', zoomDate: addDays(t, -9), zoomTime: '13:00' });
    // a Herbst going to Specialty with its Herbst Rx filled out (rx.js; made-up choices), and Dr. A's Rx details (made up)
    const hb = all.find(c => c.type === 'appliance' && c.stage === 'submit');
    if (hb) Object.assign(hb, { appliances: ['Herbst'], detail: 'Herbst', lab: LAB_SPEC, scanner: 'iTero',
      rx: { form: 'specialty-herbst', design: 'standard', mech: 'm4', bite: 'e2e', wire: ['la'], awt: ['U'], awtU: '022',
        teeth: { UR6: 'band', UL6: 'band', LR6: 'band', LR4: 'band', LL4: 'band', LL6: 'band' } } });
    DEMO.settings.rxOffice = { acct: 'DEMO-0000', license: 'DN 00000 (demo)', licExp: '02/28', email: 'office@example.com' };
    // Hawley retainers going to Specialty with their Retainer Rx filled out (rxret.js; made-up choices): Hawleys with Adams /
    // C-clasps, a lower bonded retainer 3–3, blue glitter acrylic
    const hw = all.find(c => c.type === 'appliance' && c.stage === 'mfg');
    if (hw) Object.assign(hw, { appliances: [HAWLEY], arches: ['Upper', 'Lower'], acrylic: 'Blue', glitter: true, detail: hawleyText({ arches: ['Upper', 'Lower'], acrylic: 'Blue', glitter: true }), lab: LAB_SPEC, scanner: 'iTero',
      rxRet: { form: 'specialty-retainer', palate: 'horseshoe', designU: 'hawley', designL: 'hawley', teeth: { UR6: 'adams', UL6: 'adams', LR6: 'c', LL6: 'c' }, flrL: 'c3', flrPadsL: 'compEach', flrWireL: 'solid' } });
    // an RPE going to Specialty with its Metal Rx filled out (rxmetal.js; made-up choices): a Hyrax on 3D printed first molar bands,
    // with upper archwire tubes — and, with it (Phase I), a lower Schwarz on Specialty's Functional Rx filled in with Dr. A's Schwarz
    // (rxfun.js): delta clasps on the 6s, ball clasps at the D–E contacts, the midline screw, no occlusal acrylic, pink acrylic (a standard color)
    const rp = all.find(c => c.type === 'appliance' && c.stage === 'hold');
    if (rp) Object.assign(rp, { appliances: ['Rapid Palatal Expander (RPE)', 'Schwartz'], detail: 'Rapid Palatal Expander (RPE), Schwartz', lab: LAB_SPEC, scanner: 'iTero', acrylic: 'Pink',
      rxMet: { form: 'specialty-metal', exp: ['hyrax'], teeth: { UR6: 'band', UL6: 'band' }, printed3d: true, awt: ['U'] },
      rxFun: { form: 'specialty-functional', actL: 'schwarz', exp: 'mid', dent: 'mixed', teeth: { LR6: 'delta', LL6: 'delta', LR4: 'ball', LL4: 'ball' },
        notes: 'Full-time wear for several months. Lingual horseshoe adapted into the lingual embrasures; block out only what insertion needs. No labial bow.' } });
    // in-house sets past Export STLs: attachment templates answered (some with, some without)
    all.filter(c => c.type === 'nla' && stageIndex(c) >= FLOWS.inhouse.stages.findIndex(x => x[0] === 'fab')).forEach((c, i) => { c.atTemplates = ['UL', 'none', 'U'][i % 3]; });
    // one arch only: an in-house set for the upper arch, InSmile braces on the lower
    const uo = all.find(c => c.type === 'nla' && c.stage === 'send'), lo = all.find(c => c.type === 'insmile' && c.stage === 'mfg');
    if (uo) Object.assign(uo, { treatArch: 'U', alL: '', detail: 'Aligners (In-House, upper only)', atTemplates: atFor(uo.atTemplates, 'U') || 'U' });
    if (lo) Object.assign(lo, { treatArch: 'L', detail: 'InSmile braces (lower only)' });
    // retainers: upper and lower, retainers and whitening trays (matches their detail line)
    all.filter(c => c.type === 'retainer').forEach(c => Object.assign(c, { arches: ['Upper', 'Lower'], retKinds: ['TT’s', 'WT’s'] }));
    // aligners going straight to the patient, and shipments with one-click tracking (sample numbers)
    Object.assign(all.find(c => c.type === 'oliv' && c.stage === 'shipped'), { shipToPatient: true, tracking: '1Z999AA10123456784' });
    Object.assign(all.find(c => c.type === 'nla' && c.stage === 'pack'), { shipToPatient: true });
    // an in-house plan Dr. A has approved, its aligners counted, waiting to be exported
    Object.assign(all.filter(c => c.type === 'nla' && c.stage === 'txp')[1], { stage: 'txpok', assignee: 'angelika', atTemplates: 'UL' });
    // lab emails waiting in the inbox (made-up): uLab shipped and Oliv setup ready match cases; the Partners summary
    // ships one appliance it can match and one it can't, so Today asks which case that one is
    const ul = all.find(c => c.type === 'ulab' && c.stage === 'mfg'), ol = all.find(c => c.type === 'oliv' && c.stage === 'submit'), ap = all.find(c => c.type === 'appliance' && c.stage === 'mfg');
    const fL = n => n.split(' ')[0] + ' ' + n.split(' ').slice(-1)[0][0] + '.', Fl = n => n[0] + '. ' + n.split(' ').slice(-1)[0];
    const ago = m => Date.now() - m * 60e3;
    DEMO.mail.beats = [{ id: 'b1', box: 'office@example.com', at: ago(4), seen: 2, sent: 2, err: '', ver: '1' }, { id: 'b2', box: 'records@example.com', at: ago(7), seen: 1, sent: 1, err: '', ver: '1' }];
    DEMO.mail.inbox = [
      { id: 'mdemo1', at: ago(50), done: [], mail: { box: 'office@example.com', from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order DMO42 has shipped.', date: ago(50),
        text: 'Your Order Has Shipped!\nGreat news! The following order is on the way to your office:\nOrder Number: DMO42\nPatient Name: ' + ul.patient + '\nClick here to track your order: 123456789012' } },
      { id: 'mdemo2', at: ago(180), done: [], mail: { box: 'office@example.com', from: 'Oliv Doctors <doctor@olivortho.com>', subject: 'Oliv™: ' + Fl(ol.patient) + ' (590017) setup is ready', date: ago(180),
        text: 'Please approve or request changes using the button below.', html: '<p>Please approve or request changes using the button below.</p><a href="https://portal.olivortho.com/">View Treatment Plan</a>' } },
      { id: 'mdemo3', at: ago(900), done: [], mail: { box: 'records@example.com', from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', date: ago(900), text: '',
        html: '<p>Here is your daily summary of all cases received, shipped, and placed on hold today.</p><p>No Cases Received Today</p><table><tr><th>Patient Name</th><th>Case Number</th></tr></table>' +
          '<p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>Robin T.</td><td>228700</td><td>1Z999AA10123456785</td><td>UPS</td></tr>' +
          '<tr><td>' + fL(ap.patient) + '</td><td>228701</td><td>1Z999AA10123456786</td><td>UPS</td></tr></table><p>No Cases On Hold in the last 7 Days</p>' } }
    ];
    // one in-house patient on a refinement, with the finished initial set behind it (shows the aligner total)
    const ref = Array.from(DEMO.cases.values()).find(c => c.type === 'nla' && c.stage === 'thermo');
    Object.assign(ref, { chart: '15-1001', initial: 'no', alU: 10, alL: 8, detail: 'Aligners (In-House) – refinement' });
    DEMO.cases.set('demoAl0', { id: 'demoAl0', rev: 6, v: 1, status: 'done', by: 'angelika', updatedAt: Date.now() - 90 * 86400e3, closedAt: Date.now() - 90 * 86400e3, type: 'nla', patient: ref.patient, chart: '15-1001',
      detail: 'Aligners (In-House)', stage: 'checkedin', initial: 'yes', alU: 24, alL: 20, scanDate: addDays(t, -130), labDate: addDays(t, -109), deliveryDate: addDays(t, -102), assignee: 'angelika', comments: [], createdAt: Date.now() - 130 * 86400e3,
      txStart: addDays(t, -102), txEnd: addDays(t, -102 + 548), txAt: Date.now() - 130 * 86400e3 }); // the patient's treatment: about 18 months from the first set
    for (let j = 0; j < 6; j++) {
      const id = 'demoDone' + j;
      DEMO.cases.set(id, { id, rev: 3, v: 1, status: 'done', by: 'sarah', updatedAt: Date.now() - j * 86400e3, closedAt: Date.now() - j * 86400e3, type: j % 2 ? 'retainer' : 'oliv', patient: first[(j + 9) % first.length] + ' ' + last[(j + 2) % last.length], detail: j % 2 ? "U/L TT's" : 'Aligners (Oliv)', stage: j % 2 ? 'pickup' : 'milestones', assignee: 'sarah', deliveryDate: addDays(t, -j - 1), comments: [], createdAt: Date.now() - 20 * 86400e3 });
    }
    // patient photos: drawn cartoon faces (no real people), on about two thirds of the open cases
    // (the same made-up name always gets the same face, like a patient whose photo came along from their other case)
    const faceOf = n => Array.from(String(n)).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7);
    Array.from(DEMO.cases.values()).forEach((c, i) => { if (i % 3 !== 2) { c.photo = 'dv' + i; DEMO.photos.set(c.id, { pv: c.photo, face: faceOf(c.patient) }); } });
    // a MARA Specialty made, shipped 44 days ago and checked in 4 days later: its warranty is in the half-price fit window
    // (warranty.js; added after the photos so the other demo cases keep theirs)
    const day = 86400e3;
    DEMO.cases.set('demoSpecW', { id: 'demoSpecW', rev: 4, v: 1, status: 'done', by: 'sarah', updatedAt: Date.now() - 40 * day, closedAt: Date.now() - 40 * day, type: 'appliance', patient: 'Marlowe Maraday',
      appliances: ['MARA'], detail: 'MARA', lab: LAB_SPEC, stage: 'milestones', assignee: 'sarah', assistant: 'gwen', scanner: 'iTero', deliveryDate: addDays(t, -38), comments: [], createdAt: Date.now() - 60 * day, createdBy: 'amir' });
    DEMO.logs.push({ caseId: 'demoSpecW', a: 'create', at: Date.now() - 60 * day, sid: 'amir' }, { caseId: 'demoSpecW', a: 'stage', from: 'mfg', to: 'shipped', at: Date.now() - 44 * day, sid: 'sarah' },
      { caseId: 'demoSpecW', a: 'stage', from: 'shipped', to: 'milestones', at: Date.now() - 40 * day, sid: 'sarah' }, { caseId: 'demoSpecW', a: 'close', at: Date.now() - 40 * day + 60e3, sid: 'sarah' });
  },
  /* patient photos (in memory) */
  photos: new Map(),
  async rulesLevel() { return 2; },
  /* the patient index: in memory every case is at hand, so a patient's cases are found by their keys (histKeys in ui.js) */
  idxOn: true,
  async loadPatients(keys) { const want = new Set(keys); return Array.from(DEMO.cases.values()).filter(c => histKeys(c).some(k => want.has(k))).map(c => JSON.parse(JSON.stringify(c))); },
  async indexCases() { return { seen: DEMO.cases.size, fixed: 0, missed: 0 }; },
  /* backups: the demo's file holds its made-up cases as they are (nothing is sealed in the demo) */
  async backupDump() {
    const meta = ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'closedAt'];
    return { demo: true, cases: Array.from(DEMO.cases.values()).map(c => { const data = {}; Object.keys(c).filter(k => !meta.includes(k)).forEach(k => { data[k] = JSON.parse(JSON.stringify(c[k])); });
      return { id: c.id, status: c.status, closedAt: c.closedAt || null, data }; }), photos: [], roster: DEMO.roster.slice(), settings: Object.assign({}, DEMO.settings), keys: { current: DEMO.curV }, recovery: null };
  },
  async backupOpen(file) {
    if (!file.demo) throw errCode('backup-demo');
    return { cases: file.cases.map(x => ({ id: x.id, status: x.status, closedAt: x.closedAt, data: JSON.parse(JSON.stringify(x.data || {})) })), photos: new Map(), foreign: false };
  },
  async getPhoto(id) {
    const p = DEMO.photos.get(id); if (!p) return null;
    if (!p.bytes) p.bytes = await demoFace(p.face);
    return { pv: p.pv, bytes: p.bytes };
  },
  async setPhoto(id, bytes, action) {
    const pv = bytes ? 'dv' + uid8() : '';
    await DEMO.mutateCase(id, d => { if (!bytes && !d.photo) return 'skip'; d.photo = pv; }, action || { a: 'photo', how: bytes ? 'add' : 'remove' });
    if (bytes) DEMO.photos.set(id, { pv, bytes }); else DEMO.photos.delete(id);
    return pv;
  },
  start(h) {
    DEMO.h = h;
    h.settings(DEMO.settings); h.roster(DEMO.roster.slice()); h.members(DEMO.members.slice());
    h.cases(Array.from(DEMO.cases.values()).filter(c => c.status === 'open').map(c => JSON.parse(JSON.stringify(c))), [], false);
    if (h.inbox) setTimeout(() => h.inbox(), 30);
  },
  /* lab-email updates: the inbox as the app would see it after opening each sealed email */
  mail: { on: true, beats: [], inbox: [] },
  async mailState() { return { on: DEMO.mail.on, pub: { senders: MAIL_SENDERS }, beats: DEMO.mail.beats.slice(), bots: DEMO.mail.on ? [{ uid: 'bot', email: 'mailbot.demo@staff.example' }] : [] }; },
  async mailSetup() { DEMO.mail.on = true; return DEMO.mailCreds(); },
  async mailCreds() { return DEMO.mail.on ? { email: 'mailbot.demo@staff.example', password: 'demo-only-not-a-real-login' } : null; },
  async mailOff() { DEMO.mail.on = false; },
  async mailSenders() { },
  async inboxLoad() { return JSON.parse(JSON.stringify(DEMO.mail.inbox)); },
  async inboxClaim() { return true; },
  async inboxDone(id, idx) { const x = DEMO.mail.inbox.find(i => i.id === id); if (x) x.done = Array.from(new Set((x.done || []).concat(idx))); },
  async inboxDelete(id) { DEMO.mail.inbox = DEMO.mail.inbox.filter(i => i.id !== id); },
  emit(c) {
    if (!DEMO.h) return;
    if (c.status === 'open') DEMO.h.cases([JSON.parse(JSON.stringify(c))], [], false);
    else DEMO.h.cases([], [c.id], false);
  },
  async createCases(list) {
    return list.map(item => {
      const id = 'demo' + uid8();
      const c = Object.assign({}, item.data, { id, rev: 1, v: 1, status: item.status || 'open', by: DEMO.me.staffId, updatedAt: Date.now(), closedAt: item.status === 'done' ? (item.closedAt || Date.now()) : null });
      if (item.photo) { c.photo = 'dv' + uid8(); DEMO.photos.set(id, { pv: c.photo, bytes: item.photo }); }
      item.id = id; item.photoV = c.photo || '';
      DEMO.cases.set(id, c); DEMO.logs.push({ caseId: id, a: (item.action || { a: 'create' }).a, at: Date.now(), sid: DEMO.me.staffId }); DEMO.emit(c); return id;
    });
  },
  async createCase(data, photo) { return (await DEMO.createCases([{ data, photo: photo || null }]))[0]; },
  async mutateCase(id, fn, action) {
    const c = DEMO.cases.get(id); if (!c) throw errCode('gone');
    const data = JSON.parse(JSON.stringify(c)); const st = fn(data);
    if (st === 'skip') throw errCode('skip');
    (DEMO.versions[id] = DEMO.versions[id] || []).push({ rev: c.rev, replacedAt: Date.now(), replacedBy: DEMO.me.staffId, replacedHow: action && action.a, data: JSON.parse(JSON.stringify(c)) });
    if (st === 'done' || st === 'open') { data.status = st; data.closedAt = st === 'done' ? Date.now() : null; }
    data.rev++; data.updatedAt = Date.now(); data.by = DEMO.me.staffId;
    DEMO.cases.set(id, data); if (action) DEMO.logs.push(Object.assign({ caseId: id, at: Date.now(), sid: DEMO.me.staffId }, action));
    await new Promise(r => setTimeout(r, 60)); DEMO.emit(data);
  },
  async deleteCase(id) { const c = DEMO.cases.get(id); if (c) DEMO.deleted.push({ caseId: id, at: Date.now(), sid: DEMO.me.staffId, data: JSON.parse(JSON.stringify(c)) }); DEMO.cases.delete(id); DEMO.photos.delete(id); if (c && DEMO.h) DEMO.h.cases([], [id], false); },
  async loadClosed() { return Array.from(DEMO.cases.values()).filter(c => c.status === 'done').map(c => JSON.parse(JSON.stringify(c))); },
  async loadAll() { return Array.from(DEMO.cases.values()).map(c => JSON.parse(JSON.stringify(c))); },
  async caseLog(id) { return DEMO.logs.filter(l => l.caseId === id).slice().sort((a, b) => a.at - b.at); },
  async activity() { return DEMO.logs.slice().sort((a, b) => b.at - a.at).slice(0, 60); },
  // (the Workload page's history: made up the first time it's asked for — see workSeed)
  async workLog(since, until) { DEMO.workSeed(); return DEMO.logs.map((l, i) => Object.assign({ id: 'dl' + i }, l)).filter(l => l.at >= since && (!until || l.at < until)); },
  /* about 90 days of made-up history for the Workload page: the assistants entering cases, making retainers and in-house sets, moving
     cases along — each at their own pace, so there's something to compare. All completed, with names no other demo patient has; made the
     first time the page opens, so everything else in the demo stays as it was. The open demo cases count as entered by their assistant. */
  workSeed() {
    if (DEMO.worked) return; DEMO.worked = true;
    let sd = 20261005; const R = () => { sd = sd + 0x6D2B79F5 | 0; let t = Math.imul(sd ^ sd >>> 15, 1 | sd); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(R() * a.length)], H = 3600e3, D = 864e5;
    const first = ['Ari', 'Bea', 'Cal', 'Dov', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Joss', 'Kit', 'Lev', 'Mae', 'Ned', 'Oz', 'Pia', 'Rae', 'Sol', 'Tess', 'Uma', 'Vic', 'Wes', 'Xan', 'Zoe'];
    const last = ['Pastly', 'Oldfield', 'Formerton', 'Yesterly', 'Backwell', 'Priorson'];
    const team = ['sarah', 'angelika', 'gwen', 'kaylee'];
    // w: how many of the cases they enter; late: how often a case is entered a day or more after the scan; make: how long they take to make one
    const pace = { sarah: { w: 3, late: .1, make: .8 }, angelika: { w: 3, late: .3, make: 1.4 }, gwen: { w: 2, late: .55, make: 2.6 }, kaylee: { w: 2, late: .2, make: 1 } };
    const enterer = () => { let x = R() * 10; for (const k of team) { x -= pace[k].w; if (x < 0) return k; } return team[0]; };
    const day0 = new Date(); day0.setHours(0, 0, 0, 0); let n = 0;
    for (let d = 92; d >= 1; d--) {
      const day = new Date(day0); day.setDate(day.getDate() - d); if (day.getDay() === 0 || day.getDay() === 6) continue; // office days
      for (let j = 1 + Math.floor(R() * 3); j > 0; j--) {
        const who = enterer(), id = 'demoHist' + (n++), type = pick(['retainer', 'retainer', 'retainer', 'nla', 'nla', 'oliv', 'angel', 'appliance', 'mouthguard']);
        const created = day.getTime() + (8.5 + R() * 8) * H, lag = R() < pace[who].late ? 1 + Math.floor(R() * 3) : 0;
        const c = { id, rev: 1, v: 1, status: 'done', by: who, type, patient: pick(first) + ' ' + pick(last), detail: '', stage: '', assignee: who, assistant: who, createdBy: who, createdAt: created,
          scanDate: isoOf(new Date(created - lag * D)), comments: [] };
        const L = [{ caseId: id, a: 'create', at: created, sid: who }]; let t = created;
        const mv = (from, to, after, by) => { t += after; L.push({ caseId: id, a: 'stage', from, to, at: t, sid: by }); };
        if (type === 'retainer' || type === 'mouthguard') {
          Object.assign(c, type === 'retainer' ? { detail: "U/L TT's", arches: ['Upper', 'Lower'], retKinds: ['TT’s'] } : { detail: 'Mouthguard (U)' });
          const maker = R() < .75 ? who : pick(team);
          mv('print', 'milestones', (1.5 + R() * 30 * pace[maker].make) * H, maker); mv('milestones', 'pickup', (1 + R() * 20) * H, pick(team)); mv('pickup', 'pickedup', (2 + R() * 60) * H, 'sarah'); c.stage = 'pickedup';
        } else if (type === 'nla') {
          const al = [8, 10, 12, 14, 16, 18, 20, 22, 24], maker = R() < .7 ? who : pick(team);
          Object.assign(c, { detail: 'Aligners (In-House)', initial: 'yes', alU: pick(al), alL: pick(al), atTemplates: 'none', stage: 'txp' });
          mv('txp', 'txpok', (6 + R() * 40) * H, 'amir');
          ['fab', 'send', 'print', 'thermo', 'trim', 'polish', 'wash', 'pack'].reduce((from, to) => { mv(from, to, (1 + R() * 9 * pace[maker].make) * H, maker); return to; }, 'txpok');
          mv('pack', 'checkedin', (4 + R() * 40) * H, pick(team)); c.stage = 'checkedin';
        } else if (type === 'appliance') {
          Object.assign(c, { detail: 'Herbst', appliances: ['Herbst'], lab: LAB_SPEC });
          mv('submit', 'submitted', (2 + R() * 30) * H, who); mv('submitted', 'mfg', (20 + R() * 30) * H, 'amir'); mv('mfg', 'shipped', (3 + R() * 6) * D, who); mv('shipped', 'milestones', (1 + R() * 3) * D, pick(team)); c.stage = 'milestones';
        } else {
          c.detail = type === 'oliv' ? 'Aligners (Oliv)' : 'Aligners (Angel)';
          mv('submit', 'dra', (2 + R() * 30) * H, who); mv('dra', 'mfg', (10 + R() * 40) * H, 'amir');
          t += (4 + R() * 5) * D; L.push({ caseId: id, a: 'email', co: type, kind: 'shipped', from: 'mfg', to: 'shipped', at: t, sid: pick(team) });
          mv('shipped', 'arrived', (2 + R() * 3) * D, pick(team)); mv('arrived', 'milestones', (1 + R() * 20) * H, pick(team)); c.stage = 'milestones';
        }
        if (t > Date.now() - H) continue; // not finished yet: left out (the open demo cases stand for those)
        if (c.stage === 'pickedup') L[L.length - 1].close = 1; else L.push({ caseId: id, a: 'close', at: t + 60e3, sid: L[L.length - 1].sid }); // (picked up completes it in the same save)
        Object.assign(c, { closedAt: t + 60e3, updatedAt: t + 60e3, rev: L.length });
        DEMO.cases.set(id, c); DEMO.logs.push.apply(DEMO.logs, L);
      }
    }
    Array.from(DEMO.cases.values()).filter(c => c.status === 'open' && /^demo\d+$/.test(c.id) && c.assistant).forEach(c => { c.createdBy = c.assistant; DEMO.emit(c); });
  },
  // (like the real save, set with merge: a map — the chart note wording — is merged key by key, not replaced)
  async saveSettings(p) {
    Object.keys(p).forEach(k => { const v = p[k], o = DEMO.settings[k], map = x => x && typeof x === 'object' && !Array.isArray(x);
      DEMO.settings[k] = map(v) && map(o) ? Object.assign({}, o, v) : v; });
    if (DEMO.h) DEMO.h.settings(Object.assign({}, DEMO.settings));
  },
  async addStaff(name, username, rid) {
    username = slug(username); if (DEMO.roster.some(r => r.sid === username && r.active)) throw errCode('taken');
    DEMO.roster = DEMO.roster.filter(r => r.sid !== username).concat([Object.assign({ sid: username, name, initials: initials(name), role: 'staff', active: true, username }, rid ? { rid } : {})]);
    DEMO.members.push({ uid: 'u-' + username + uid8(), staffId: username, name, username, role: 'staff', active: true, mustSetup: true });
    DEMO.h.roster(DEMO.roster.slice()); DEMO.h.members(DEMO.members.slice());
    return { temp: tempPassword(), username };
  },
  async setStaffPhoto(sid, photo, src) {
    const r = DEMO.roster.find(x => x.sid === sid); if (!r) return;
    if (photo) Object.assign(r, { photo, photoSrc: src }); else { delete r.photo; delete r.photoSrc; }
    DEMO.h.roster(DEMO.roster.map(x => Object.assign({}, x)));
  },
  async reissue(sid) { const r = DEMO.roster.find(x => x.sid === sid); DEMO.members.forEach(m => { if (m.staffId === sid) m.mustSetup = true; }); DEMO.h.members(DEMO.members.slice()); return { temp: tempPassword(), username: r.username || sid }; },
  async removeStaff(sid) { DEMO.roster.forEach(r => { if (r.sid === sid) r.active = false; }); DEMO.members.forEach(m => { if (m.staffId === sid) m.active = false; }); DEMO.h.roster(DEMO.roster.slice()); DEMO.h.members(DEMO.members.slice()); },
  async rotate(progress) { const n = DEMO.cases.size; for (let i = 1; i <= n; i++) { if (progress) progress(i, n); } DEMO.curV++; return { cases: n, pendingInvites: 0 }; },
  async newRecoveryCode() { return recoveryCode(); },
  async caseVersions(id) { return (DEMO.versions[id] || []).slice().reverse(); },
  async restoreVersion(id, data) { return DEMO.mutateCase(id, d => { Object.keys(d).forEach(k => { if (!['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'closedAt'].includes(k)) delete d[k]; }); Object.assign(d, JSON.parse(JSON.stringify(data))); }, { a: 'restore' }); },
  // (one brought back already — from here or a backup — isn't offered again, as in FB.deletedCases)
  async deletedCases() { const here = new Set(Array.from(DEMO.cases.values()).map(caseSig).filter(Boolean)); return DEMO.deleted.filter(x => !here.has(caseSig(x.data))).reverse(); },
  async undelete(item) { DEMO.deleted = DEMO.deleted.filter(x => x !== item); const data = Object.assign({}, item.data); delete data.photo; return DEMO.createCases([{ data, action: { a: 'restore' } }]); },
  versions: {}, deleted: [],
  async changePassword() { },
  get curV_() { return DEMO.curV; }
};
/* a made-up cartoon face for the demo (drawn, not a photo of anyone): a JPEG like the real ones */
function demoFace(n) {
  const R = k => { const x = Math.sin((n + 1) * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
  const pick = (a, k) => a[Math.floor(R(k) * a.length)];
  const cv = document.createElement('canvas'); cv.width = cv.height = 160; const g = cv.getContext('2d');
  g.fillStyle = pick(['#C0FBEC', '#E5EAF8', '#FEF2D7', '#FFE7E1', '#E8ECF2', '#BCC8EE'], 1); g.fillRect(0, 0, 160, 160);
  const skin = pick(['#F6D2B8', '#EBC09E', '#D9A47E', '#B97F57', '#8E5A3B', '#6B4128'], 2), hair = pick(['#2B1D14', '#4A3121', '#7A4E2D', '#B9894A', '#E2C27A', '#1B1B1B'], 3);
  const ell = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  const long = R(4) > .55;
  if (long) { g.fillStyle = hair; g.beginPath(); g.moveTo(38, 80); g.quadraticCurveTo(40, 30, 80, 28); g.quadraticCurveTo(120, 30, 122, 80); g.lineTo(126, 132); g.lineTo(34, 132); g.closePath(); g.fill(); }
  g.fillStyle = pick(['#1D3EA9', '#34C49E', '#FA624D', '#F6AF24', '#385686', '#5471A0'], 5); g.beginPath(); g.moveTo(22, 160); g.quadraticCurveTo(28, 122, 80, 118); g.quadraticCurveTo(132, 122, 138, 160); g.closePath(); g.fill();
  g.fillStyle = skin; g.fillRect(68, 100, 24, 22);
  ell(80, 78, 33, 39, skin); ell(47, 80, 6, 9, skin); ell(113, 80, 6, 9, skin);
  g.fillStyle = hair; g.beginPath();
  if (R(6) > .5) { g.ellipse(80, 54, 36, 24, 0, Math.PI, Math.PI * 2); g.lineTo(116, 62); g.quadraticCurveTo(84, 44, 46, 64); } else { g.ellipse(80, 56, 35, 26, 0, Math.PI * 1.02, Math.PI * 1.98); g.quadraticCurveTo(70, 52, 45, 66); }
  g.closePath(); g.fill();
  if (!long && R(7) > .7) ell(80, 30, 13, 11, hair);
  ell(67, 78, 3.6, 4.4, '#1B2F4C'); ell(93, 78, 3.6, 4.4, '#1B2F4C');
  g.strokeStyle = hair; g.lineWidth = 2.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(61, 69); g.lineTo(72, 68); g.moveTo(88, 68); g.lineTo(99, 69); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(66, 95); g.quadraticCurveTo(80, 110, 94, 95); g.closePath(); g.fill();
  g.strokeStyle = '#B9C2CE'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(68, 98); g.lineTo(92, 98); g.stroke(); // braces wire
  g.fillStyle = '#969FAB'; [71, 76, 80, 84, 89].forEach(x => g.fillRect(x - 1.5, 96.5, 3, 3));
  g.strokeStyle = '#9C4A3A'; g.lineWidth = 2; g.beginPath(); g.moveTo(66, 95); g.quadraticCurveTo(80, 110, 94, 95); g.stroke();
  return new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/jpeg', 0.85));
}
