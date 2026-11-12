/* =====================================================================
   Demo backend: made-up doctors, everything in memory, nothing saved.
   Opened with ?demo. Every name, address and email here is invented
   (555-01xx numbers and example.com addresses don't belong to anyone).
   ===================================================================== */
const DEMO = {
  me: null, h: null, docs: new Map(), pending: 0, office: null, seq: 0,
  isOwner() { return true; },
  async signIn() {
    DEMO.me = { uid: 'u-amir', staffId: 'amir', name: 'Dr. Akhavan', role: 'owner', active: true };
    if (!DEMO.docs.size) DEMO.seed();
    return { state: 'ok' };
  },
  async signOut() { DEMO.h = null; },
  stop() { },
  seed() {
    [
      ['Dentist', 'Jordan', 'Sample', 'Sample Family Dentistry', '100 Example Street', 'Suite 2', 'Gainesville, FL 32607', 'office@samplefamily.example.com', '(352) 555-0111'],
      ['Dentist', 'Casey', 'Demo', 'Demo Dental Care', '2500 Placeholder Road', '', 'Gainesville, FL 32606', 'frontdesk@demodental.example.com', '(352) 555-0112'],
      ['Dentist', 'Morgan', 'Testcase', 'Testcase & Associates', '14 Mockingbird Lane', '', 'Alachua, FL 32615', '', '(386) 555-0113'],
      ['Dentist', '', '', 'Example Dental Group', '700 Main Street', '', 'Ocala, FL 34471', 'info@exampledental.example.com', ''],
      ['Pediatric Dentistry', 'Riley', 'Placeholder', 'Little Smiles (demo)', '88 Sample Avenue', '', 'Gainesville, FL 32605', 'hello@littlesmiles.example.com', '(352) 555-0114'],
      ['Oral Surgery', 'Avery', 'Mockley', 'Demo Oral & Facial Surgery', '4100 Example Boulevard', 'Suite 300', 'Gainesville, FL 32608', 'referrals@demoomfs.example.com', '(352) 555-0115'],
      ['Oral Surgery', 'Quinn', 'Example', 'Example Oral Surgery', '9 Test Court', '', 'Ocala, FL 34474', 'surgery@exampleos.example.com', '(352) 555-0116'],
      ['Periodontics', 'Harper', 'Sample', 'Sample Periodontics', '310 Placeholder Way', '', 'Gainesville, FL 32607', 'perio@sampleperio.example.com', '(352) 555-0117'],
      ['Endodontics', 'Rowan', 'Demo', 'Demo Endodontics', '56 Example Circle', '', 'Gainesville, FL 32606', 'endo@demoendo.example.com', '(352) 555-0118'],
      ['Prosthodontics', 'Skyler', 'Testcase', 'Testcase Prosthodontics', '1200 Mock Street', '', 'Gainesville, FL 32601', '', '(352) 555-0119']
    ].forEach(r => {
      const id = 'd' + (++DEMO.seq);
      DEMO.docs.set(id, Object.assign(cleanDoc({ type: r[0], first: r[1], last: r[2], practice: r[3], addr1: r[4], addr2: r[5], city: r[6], email: r[7], phone: r[8] }), { id, rev: 1, v: 1 }));
    });
  },
  copy(x) { return JSON.parse(JSON.stringify(x)); },
  start(h) {
    DEMO.h = h;
    setTimeout(() => { if (DEMO.h !== h) return; h.settings({ idleMin: 30 }); h.office(DEMO.office); h.docs(Array.from(DEMO.docs.values()).map(DEMO.copy), []); }, 30);
  },
  async addDocs(list, progress) {
    const ids = list.map(d => { const id = 'd' + (++DEMO.seq); DEMO.docs.set(id, Object.assign(cleanDoc(d), { id, rev: 1, v: 1 })); return id; });
    if (progress) progress(list.length, list.length);
    if (DEMO.h) DEMO.h.docs(ids.map(id => DEMO.copy(DEMO.docs.get(id))), []);
    return ids;
  },
  async addDoc(d) { return (await DEMO.addDocs([d]))[0]; },
  async saveDoc(id, data) {
    const cur = DEMO.docs.get(id); if (!cur) throw errCode('gone');
    const next = Object.assign(cleanDoc(data), { id, rev: cur.rev + 1, v: 1 }); DEMO.docs.set(id, next);
    if (DEMO.h) DEMO.h.docs([DEMO.copy(next)], []);
  },
  async deleteDoc(id) { DEMO.docs.delete(id); if (DEMO.h) DEMO.h.docs([], [id]); },
  async saveOffice(cfg) { DEMO.office = DEMO.copy(cfg); if (DEMO.h) DEMO.h.office(DEMO.copy(cfg)); },
  async resealOld() { return 0; }
};
