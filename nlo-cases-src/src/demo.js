/* =====================================================================
   Demo backend: made-up patients, everything in memory, nothing saved.
   Opened with ?demo — lets the office try the app before Firebase exists.
   ===================================================================== */
const DEMO = {
  me: null, h: null, cases: new Map(), logs: [], roster: [], members: [], settings: { idleMin: 30 }, curV: 1,
  isOwner() { return true; },
  async emailFor(l) { return l; },
  async signIn() {
    DEMO.me = { uid: 'u-amir', staffId: 'amir', name: 'Dr. Akhavan', role: 'owner', active: true };
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
    DEMO.members = DEMO.roster.map((r, i) => ({ uid: 'u-' + r.sid, staffId: r.sid, name: r.name, username: r.username, role: r.role, active: true, mustSetup: i === 4, lastLogin: { toMillis: () => Date.now() - i * 3600e3 } }));
    const first = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Taylor', 'Quinn', 'Rowan', 'Skyler', 'Harper', 'Emerson', 'Finley', 'Parker', 'Reese', 'Sawyer', 'Hayden', 'Dakota', 'Elliot', 'Blake', 'Jamie', 'Logan', 'Peyton', 'Drew', 'Kendall'];
    const last = ['Sample', 'Demo', 'Testcase', 'Example', 'Placeholder', 'Mockley'];
    const t = todayISO();
    const plan = [
      ['oliv', 'submit', 'sarah', 9], ['oliv', 'dra', 'amir', 2], ['oliv', 'mfg', 'sarah', 12], ['oliv', 'shipped', 'sarah', 4], ['oliv', 'arrived', 'sarah', -1],
      ['angel', 'mfg', 'sarah', 6], ['ulab', 'submit', 'gwen', 1], ['inbrace', 'dra', 'amir', 5], ['invisalign', 'milestones', 'sarah', 0],
      ['nla', 'txp', 'amir', -2], ['nla', 'txp', 'amir', 3], ['nla', 'reset', 'angelika', 2], ['nla', 'fab', 'angelika', 6], ['nla', 'fab', 'kaylee', 8], ['nla', 'pack', 'gwen', 1],
      ['appliance', 'submit', 'sarah', 7], ['appliance', 'hold', 'amir', null], ['appliance', 'mfg', 'sarah', 15],
      ['retainer', 'print', 'angelika', 1], ['retainer', 'print', 'gwen', null], ['retainer', 'sarah', 'sarah', 0], ['retainer', 'pickup', 'sarah', -3],
      ['retreat', 'review', 'amir', 10], ['misc', 'todo', 'amir', 4], ['mouthguard', 'print', 'kaylee', 2], ['insmile', 'mfg', 'sarah', 9]
    ];
    const details = { oliv: 'Aligners (Oliv)', angel: 'Aligners (Angel)', ulab: 'Aligners (uLab)', inbrace: 'InBrace IDB', invisalign: 'Aligners (Invisalign)', nla: 'Aligners (In-House)', appliance: 'Herbst', retainer: "U/L TT's and WT's", retreat: 'Relapse — lower incisors', misc: 'Study models', mouthguard: 'Mouthguard (U)', insmile: 'InSmile braces' };
    plan.forEach((p, i) => {
      const [type, stage, who, due] = p; const id = 'demo' + i;
      const scan = addDays(t, -10 + (i % 7));
      DEMO.cases.set(id, {
        id, rev: 1, v: 1, status: 'open', by: 'amir', updatedAt: Date.now() - i * 3600e3, closedAt: null,
        type, patient: first[i % first.length] + ' ' + last[i % last.length], detail: details[type], stage, assignee: who,
        scanDate: TYPE[type].aligner ? scan : '', dueDate: due == null ? '' : addDays(t, due), labDate: TYPE[type].aligner ? addDays(scan, 21) : '', deliveryDate: TYPE[type].aligner ? addDays(scan, 28) : '',
        scanner: TYPE[type].aligner ? 'Allied Star' : '', assistant: ['angelika', 'gwen', 'kaylee'][i % 3],
        instructions: TYPE[type].aligner ? 'Close remaining spaces, improve bite.' : '', cc: '', ipr: i % 3 === 0 ? 'UR2–UR1 0.1mm, UR1–UL1 0.1mm' : '', notes: '',
        comments: i % 4 === 0 ? [{ id: 'c' + i, at: Date.now() - 7200e3, by: 'sarah', text: 'Submitted in the portal.' }] : [], createdAt: Date.now() - 86400e3 * (i + 2), createdBy: 'amir'
      });
      DEMO.logs.push({ caseId: id, a: 'create', at: Date.now() - 86400e3 * (i + 2), sid: 'amir' });
    });
    for (let j = 0; j < 6; j++) {
      const id = 'demoDone' + j;
      DEMO.cases.set(id, { id, rev: 3, v: 1, status: 'done', by: 'sarah', updatedAt: Date.now() - j * 86400e3, closedAt: Date.now() - j * 86400e3, type: j % 2 ? 'retainer' : 'oliv', patient: first[(j + 9) % first.length] + ' ' + last[(j + 2) % last.length], detail: j % 2 ? "U/L TT's" : 'Aligners (Oliv)', stage: j % 2 ? 'pickup' : 'milestones', assignee: 'sarah', dueDate: addDays(t, -j - 1), comments: [], createdAt: Date.now() - 20 * 86400e3 });
    }
  },
  start(h) {
    DEMO.h = h;
    h.settings(DEMO.settings); h.roster(DEMO.roster.slice()); h.members(DEMO.members.slice());
    h.cases(Array.from(DEMO.cases.values()).filter(c => c.status === 'open').map(c => JSON.parse(JSON.stringify(c))), [], false);
  },
  emit(c) {
    if (!DEMO.h) return;
    if (c.status === 'open') DEMO.h.cases([JSON.parse(JSON.stringify(c))], [], false);
    else DEMO.h.cases([], [c.id], false);
  },
  async createCases(list) {
    return list.map(item => {
      const id = 'demo' + uid8();
      const c = Object.assign({}, item.data, { id, rev: 1, v: 1, status: item.status || 'open', by: DEMO.me.staffId, updatedAt: Date.now(), closedAt: item.status === 'done' ? (item.closedAt || Date.now()) : null });
      DEMO.cases.set(id, c); DEMO.logs.push({ caseId: id, a: (item.action || { a: 'create' }).a, at: Date.now(), sid: DEMO.me.staffId }); DEMO.emit(c); return id;
    });
  },
  async createCase(data) { return (await DEMO.createCases([{ data }]))[0]; },
  async mutateCase(id, fn, action) {
    const c = DEMO.cases.get(id); if (!c) throw errCode('gone');
    (DEMO.versions[id] = DEMO.versions[id] || []).push({ rev: c.rev, replacedAt: Date.now(), replacedBy: DEMO.me.staffId, replacedHow: action && action.a, data: JSON.parse(JSON.stringify(c)) });
    const data = JSON.parse(JSON.stringify(c)); const st = fn(data);
    if (st === 'done' || st === 'open') { data.status = st; data.closedAt = st === 'done' ? Date.now() : null; }
    data.rev++; data.updatedAt = Date.now(); data.by = DEMO.me.staffId;
    DEMO.cases.set(id, data); if (action) DEMO.logs.push(Object.assign({ caseId: id, at: Date.now(), sid: DEMO.me.staffId }, action));
    await new Promise(r => setTimeout(r, 60)); DEMO.emit(data);
  },
  async deleteCase(id) { const c = DEMO.cases.get(id); if (c) DEMO.deleted.push({ caseId: id, at: Date.now(), sid: DEMO.me.staffId, data: JSON.parse(JSON.stringify(c)) }); DEMO.cases.delete(id); if (c && DEMO.h) DEMO.h.cases([], [id], false); },
  async loadClosed() { return Array.from(DEMO.cases.values()).filter(c => c.status === 'done').map(c => JSON.parse(JSON.stringify(c))); },
  async loadAll() { return Array.from(DEMO.cases.values()).map(c => JSON.parse(JSON.stringify(c))); },
  async caseLog(id) { return DEMO.logs.filter(l => l.caseId === id).slice().sort((a, b) => a.at - b.at); },
  async activity() { return DEMO.logs.slice().sort((a, b) => b.at - a.at).slice(0, 60); },
  async saveSettings(p) { Object.assign(DEMO.settings, p); if (DEMO.h) DEMO.h.settings(DEMO.settings); },
  async addStaff(name, username) {
    username = slug(username); if (DEMO.roster.some(r => r.sid === username && r.active)) throw errCode('taken');
    DEMO.roster = DEMO.roster.filter(r => r.sid !== username).concat([{ sid: username, name, initials: initials(name), role: 'staff', active: true, username }]);
    DEMO.members.push({ uid: 'u-' + username + uid8(), staffId: username, name, username, role: 'staff', active: true, mustSetup: true });
    DEMO.h.roster(DEMO.roster.slice()); DEMO.h.members(DEMO.members.slice());
    return { temp: tempPassword(), username };
  },
  async reissue(sid) { const r = DEMO.roster.find(x => x.sid === sid); DEMO.members.forEach(m => { if (m.staffId === sid) m.mustSetup = true; }); DEMO.h.members(DEMO.members.slice()); return { temp: tempPassword(), username: r.username || sid }; },
  async removeStaff(sid) { DEMO.roster.forEach(r => { if (r.sid === sid) r.active = false; }); DEMO.members.forEach(m => { if (m.staffId === sid) m.active = false; }); DEMO.h.roster(DEMO.roster.slice()); DEMO.h.members(DEMO.members.slice()); },
  async rotate(progress) { const n = DEMO.cases.size; for (let i = 1; i <= n; i++) { if (progress) progress(i, n); } DEMO.curV++; return { cases: n, pendingInvites: 0 }; },
  async newRecoveryCode() { return recoveryCode(); },
  async caseVersions(id) { return (DEMO.versions[id] || []).slice().reverse(); },
  async restoreVersion(id, data) { return DEMO.mutateCase(id, d => { Object.keys(d).forEach(k => { if (!['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'closedAt'].includes(k)) delete d[k]; }); Object.assign(d, JSON.parse(JSON.stringify(data))); }, { a: 'restore' }); },
  async deletedCases() { return DEMO.deleted.slice().reverse(); },
  async undelete(item) { DEMO.deleted = DEMO.deleted.filter(x => x !== item); return DEMO.createCases([{ data: item.data, action: { a: 'restore' } }]); },
  versions: {}, deleted: [],
  async changePassword() { },
  get curV_() { return DEMO.curV; }
};
