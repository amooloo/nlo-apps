/* The alert script (dist/nlo-timeclock-alerts.gs, built from robot/script.js + src/engine.js) against the Firebase emulators,
   with stand-ins for Google's Apps Script services (email, the cache, the script's properties, triggers) and for ntfy (a
   small local server that records each push, and can be told to fail). Made-up people only.
     python3 build.py && npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/robot.test.js"
   What it covers: setup and the 5-minute timer; reading the clock through the rules as the script's own login; the alerts
   (the newest heads-up, overtime, from home, wrong PINs, someone who left gets none); one email per check and a push per
   alert; each alert once — again on the next check, and from a second copy of the script; a push that fails is tried again
   later on its own; Dr. A's test; the daily summary; nights; no alert settings; a login that was turned off (and the warning
   email after 3 failures). */
const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
const TCE = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8') + '\nTCE', vm.createContext({ Intl, Date, Math, JSON, Object, Array, String, Number, Set, Map }));
const { load, calls } = require('./gas_fakes');
const P = 'demo-nlo-cases', FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', NTFY_PORT = 8799, NTFY = 'http://127.0.0.1:' + NTFY_PORT;
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tcbot-'));
const NTFY_LOG = path.join(TMP, 'ntfy.jsonl'), NTFY_FAIL = path.join(TMP, 'ntfy.fail');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + name + (c || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); };

async function admin(method, p, body) {
  const r = await fetch(FS + '/' + p, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { code: r.status, json: j };
}
/* plain values → Firestore's typed fields */
function F(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(F) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, F(x)])) } };
}
const put = (p, obj) => admin('PATCH', p, { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, F(v)])) });
const del = p => admin('DELETE', p);
async function list(coll) {
  const r = await fetch(FS + ':runQuery', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }] } }) });
  const j = await r.json();
  return j.filter(x => x.document).map(x => { const o = { id: x.document.name.split('/').pop() }; Object.entries(x.document.fields || {}).forEach(([k, v]) => { o[k] = Object.values(v)[0]; }); return o; });
}

const pushes = () => (fs.existsSync(NTFY_LOG) ? fs.readFileSync(NTFY_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const tsMs = s => Date.parse(s);

(async () => {
  // the stand-in for ntfy, in its own process (the script's calls block this one)
  const ntfy = cp.spawn(process.execPath, ['-e', `
    const http = require('http'), fs = require('fs');
    http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
      if (fs.existsSync(${JSON.stringify(NTFY_FAIL)})) { r.statusCode = 500; return r.end('down'); }
      fs.appendFileSync(${JSON.stringify(NTFY_LOG)}, b.replace(/\\n/g, ' ') + '\\n'); r.end('{}'); }); }).listen(${NTFY_PORT}, '127.0.0.1');`], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 400));
  try {
    // start from empty emulators (another test file may have run in the same emulators first)
    await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
    await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts', { method: 'DELETE' });
    const now = Date.now(), H = 3600000;
    const parts = ms => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; }); return o; };
    const p0 = parts(now), dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p0.weekday);
    const today = p0.year + '-' + p0.month + '-' + p0.day;
    // midnight at the office today, then any wall-clock time on a day before
    const off = (Number(p0.hour) * 60 + Number(p0.minute)) * 60000 + (now % 60000);
    const midnight = now - off;
    const at = (daysBack, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(midnight - daysBack * 86400000 + (h * 60 + m) * 60000); };
    // (a day back across a clock change is an hour off — fine here: the hours below stay well clear of every boundary)

    // the office: its workweek started 3 days ago, every day is an office day, no early/late/long alerts (tested in unit tests)
    await put('meta/setup', { owner: 'owner', at: new Date() });
    await put('meta/keys', { current: 1 });
    for (const [sid, active] of [['gwen', true], ['kim', true], ['wila', true], ['lee', false]]) await put('roster/' + sid, { name: sid[0].toUpperCase() + sid.slice(1) + ' Tester', role: 'staff', active, initials: 'XT' });
    for (const sid of ['gwen', 'kim', 'lee']) await put('tcStaff/' + sid, { on: true, home: false, hdays: [], early: '', cap: 0, pinAt: new Date(), at: new Date(), by: 'owner' });
    await put('tcStaff/wila', { on: true, home: true, hdays: [], early: '', cap: 0, pinAt: new Date(), at: new Date(), by: 'owner' });
    await put('meta/tc', { wk: (dow + 4) % 7, ot: 40, thr: [36, 38], early: '', late: '', shift: 0, brk: 20, days: [0, 1, 2, 3, 4, 5, 6], pay: '', at: new Date() });
    await put('meta/tcAlerts', { emails: ['dr.test@example.com', 'manager@example.com'], topic: 'nlo-clock-test1', route: {}, digest: '', test: null, at: new Date() });
    let n = 0; const pid = () => 'p' + (++n).toString(16).padStart(24, '0');
    const punch = (sid, kind, when, src) => put('tcPunch/' + pid(), { sid, kind, at: when, src: src || 'kiosk', by: 'kiosk1' });
    for (const d of [3, 2, 1]) {
      await punch('gwen', 'in', at(d, '07:00')); await punch('gwen', 'out', at(d, '19:40'));  // 3 × 12 h 40 = 38 h
      await punch('kim', 'in', at(d, '07:00')); await punch('kim', 'out', at(d, '20:30'));    // 3 × 13.5 h = 40.5 h
      await punch('lee', 'in', at(d, '07:00')); await punch('lee', 'out', at(d, '20:30'));    // left the practice: no alerts
    }
    await punch('wila', 'in', new Date(Math.max(midnight + 5 * 60000, now - H)), 'home');
    await put('tcTry/kim', { n: 5, t0: new Date(now - 5 * 60000), at: new Date(now - 3 * 60000), ok: false, k: 'kiosk1', bad: 5, u: '' });

    // the script's own login, as Dr. A's page makes it
    const su = await (await fetch(AUTH + '/accounts:signUp?key=any', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tc-alerts-test@example.com', password: 'pw-robot-123456', returnSecureToken: true }) })).json();
    await put('tcBots/' + su.localId, { email: 'tc-alerts-test@example.com', at: new Date() });
    const cfg = { apiKey: 'any', projectId: P, botEmail: 'tc-alerts-test@example.com', botPassword: 'pw-robot-123456', authBase: AUTH, fsBase: 'http://127.0.0.1:8080/v1', ntfyBase: NTFY, appUrl: 'http://127.0.0.1/nlo-timeclock.html' };

    console.log('\n# setup');
    const bad = load(null, 'records@example.com');
    let e1 = ''; try { bad.run('setup()'); } catch (e) { e1 = e.message; }
    ok('a copy with no login in it says to copy the script again', /no NLO Time Clock login/.test(e1), e1);
    const wrong = load(Object.assign({}, cfg, { botPassword: 'nope' }), 'records@example.com');
    let e2 = ''; try { wrong.run('setup()'); } catch (e) { e2 = e.message; }
    ok('a wrong password: “Couldn’t sign in”, and nothing turned on', /Couldn’t sign in/.test(e2) && /Nothing was turned on/.test(e2) && wrong.triggers.length === 0, e2);

    const A = load(cfg, 'records@example.com');
    const r1 = A.run('setup()');
    ok('setup turns on a check every 5 minutes', A.triggers.length === 1 && A.triggers[0].fn === 'tick' && A.triggers[0].every === 5, A.triggers);
    ok('…and checks right away: 4 alerts', /^4 alerts sent$/.test(r1), r1);
    A.run('setup()');
    ok('running setup again keeps one timer', A.triggers.length === 1);

    console.log('\n# the first check');
    const mails = A.mail.slice(0, 1)[0] || {}, ps = pushes();
    ok('one email for the check, to both addresses', A.mail.length === 1 && mails.to === 'dr.test@example.com,manager@example.com', A.mail.map(m => m.to));
    ok('…its subject is the most important alert', /^(Overtime: Kim is at 40\.5 h|Kim: 5 wrong PINs at the time clock) \(\+2 more\)$/.test(mails.subject), mails.subject);
    ok('…with the 38 h heads-up for Gwen (not 36 too)', /Gwen: 38 h this week/.test(mails.body) && !/Gwen: 36 h/.test(mails.body), mails.body);
    ok('…overtime for Kim, without heads-ups for her', /Overtime: Kim is at 40\.5 h/.test(mails.body) && !/Kim: 3[68] h/.test(mails.body));
    ok('…5 wrong PINs for Kim', /Someone typed a wrong PIN for Kim 5 times/.test(mails.body));
    ok('…not Wila clocking in from home (a push only, unless Dr. A picks email)', !/Wila clocked in from home/.test(mails.body));
    ok('…nothing about Lee, who left', !/Lee/.test(mails.body));
    ok('…and a link back to the time clock', /NLO Time Clock: http:\/\/127\.0\.0\.1\/nlo-timeclock\.html/.test(mails.body));
    ok('a push for each of the 4, to the topic', ps.length === 4 && ps.every(x => x.topic === 'nlo-clock-test1'), ps);
    ok('…Wila’s from home among them, quieter', ps.some(x => x.title === 'Wila clocked in from home' && x.priority === 2));
    ok('…overtime loud', ps.some(x => /^Overtime: Kim/.test(x.title) && x.priority === 4));
    const sent1 = await list('tcSent');
    ok('the alerts sent are noted, each by email and push as chosen', sent1.length === 4 && sent1.every(x => x.st === 'sent') &&
      sent1.find(x => x.type === 'home').ch === '2' && sent1.find(x => x.type === 'ot').ch === '3', sent1.map(x => [x.type, x.st, x.ch]));
    const beat = (await list('tcBeat'))[0] || {};
    ok('the script checks in: its mailbox, version, no problem', beat.box === 'records@example.com' && beat.ver === '1' && beat.err === '' && beat.id === su.localId, beat);

    console.log('\n# each alert once');
    const r2 = A.run('check_(true)');
    ok('the next check sends nothing new', r2 === '0 alerts sent' && A.mail.length === 1 && pushes().length === 4, r2);
    const B2 = load(cfg, 'akhavan@example.com');
    B2.run('setup()');
    ok('a second copy of the script (another Gmail account) sends none of them again', B2.mail.length === 0 && pushes().length === 4, B2.mail);
    // Gwen passes 40 → one new alert, and only that one. (A manager adds her clock-in from 3 hours ago: punches always carry
    // the time they reached the server, so the script only asks for new ones; a time in the past arrives as a correction.)
    await put('tcFix/f' + '1'.repeat(24), { sid: 'gwen', op: 'add', ref: '', kind: 'in', t: Math.max(midnight + 60000, now - 3 * H), why: 'Forgot to clock in', by: 'owner', bsid: 'amir', at: new Date() });
    const r3 = A.run('check_(true)');
    ok('Gwen passes 40 h (clocked in 3 h today): the overtime alert, alone', r3 === '1 alert sent' && /Overtime: Gwen/.test(A.mail[1].subject) && !/\(\+/.test(A.mail[1].subject), [r3, A.mail[1] && A.mail[1].subject]);
    ok('…“Clocked in since” in it', /Clocked in since/.test(A.mail[1].body));

    console.log('\n# someone asks a manager to fix their time');
    // Wila left a note (waiting); Lee's (she left) and Gwen's (already answered) send nothing
    await put('tcReq/r' + '1'.repeat(24), { sid: 'wila', ps: [], note: 'Worked an extra 30 min Tuesday night', src: 'me', by: 'wila-uid', at: new Date(now - 20 * 60000), st: 'open' });
    await put('tcReq/r' + '2'.repeat(24), { sid: 'lee', ps: [{ k: 'in', t: now - 2 * H }], note: '', src: 'kiosk', by: 'kiosk1', at: new Date(now - 20 * 60000), st: 'open' });
    await put('tcReq/r' + '3'.repeat(24), { sid: 'gwen', ps: [{ k: 'in', t: now - 2 * H }], note: '', src: 'kiosk', by: 'kiosk1', at: new Date(now - 20 * 60000), st: 'ok' });
    const rq = A.run('check_(true)');
    ok('Wila’s note: one alert, alone', rq === '1 alert sent' && A.mail[2] && A.mail[2].subject === 'Wila left a note for the managers', [rq, A.mail[2] && A.mail[2].subject]);
    ok('…what she wrote, and where', /Wila wrote on My time \(.*\): “Worked an extra 30 min Tuesday night”\. Mark it done on the Now screen\./.test(A.mail[2].body), A.mail[2].body);
    ok('…by push too', pushes().length === 6 && pushes()[5].title === 'Wila left a note for the managers' && pushes()[5].priority === 3, pushes().slice(5));
    ok('…nothing for Lee (who left) or for the one already answered', !/Lee|Gwen/.test(A.mail[2].body));
    ok('…once', A.run('check_(true)') === '0 alerts sent' && A.mail.length === 3);

    console.log('\n# someone keeps trying a coworker’s PIN (slower than the lockout)');
    await put('tcTry/gwen', { n: 4, t0: new Date(now - 6 * 60000), at: new Date(now - 3 * 60000), ok: false, k: 'kiosk1', bad: 9, u: '' });
    const rb = A.run('check_(true)');
    ok('9 wrong PINs since her PIN last worked: an alert', rb === '1 alert sent' && /^Gwen: 9 wrong PINs since the last right one$/.test(A.mail[3].subject) && /someone may be trying to guess it/.test(A.mail[3].body), [rb, A.mail[3] && A.mail[3].subject]);
    ok('…by push too, loud', pushes().length === 7 && pushes()[6].priority === 4);
    ok('…once', A.run('check_(true)') === '0 alerts sent');

    console.log('\n# a push that fails');
    fs.writeFileSync(NTFY_FAIL, '1');
    await put('meta/tcAlerts', { emails: ['dr.test@example.com', 'manager@example.com'], topic: 'nlo-clock-test1', route: {}, digest: '', test: new Date(), at: new Date() });
    const r4 = A.run('check_(true)');
    ok('Dr. A’s test goes by email even with ntfy down', /^1 alert sent — Phone push didn’t go/.test(r4) && /Test alert from NLO Time Clock/.test(A.mail[4].subject), r4);
    const t1 = (await list('tcSent')).find(x => x.type === 'test');
    ok('…noted as not fully sent (email only)', t1 && t1.st === 'fail' && t1.ch === '1', t1);
    ok('…the problem shows on the check-in', /Phone push didn’t go: ntfy answered 500/.test((await list('tcBeat'))[0].err));
    fs.unlinkSync(NTFY_FAIL);
    const r5 = A.run('check_(true)');
    ok('right after, it waits (no second email, no push yet)', r5 === '0 alerts sent' && A.mail.length === 5 && pushes().length === 7, [r5, pushes().length]);
    const later = load(cfg, 'records@example.com', { off: 11 * 60000 }); // the same script 11 minutes later (its own memory is fresh)
    Object.assign(later.props, A.props);
    const r6 = later.run('check_(true)');
    ok('11 minutes later: the push alone, not the email again', r6 === '1 alert sent' && later.mail.length === 0 && pushes().length === 8 && pushes()[7].title === 'Test alert from NLO Time Clock', [r6, later.mail.length, pushes().length]);
    ok('…now noted as sent both ways', (await list('tcSent')).find(x => x.type === 'test').ch === '3');

    console.log('\n# the daily summary');
    await put('meta/tcAlerts', { emails: ['dr.test@example.com'], topic: 'nlo-clock-test1', route: {}, digest: '00:00', test: null, at: new Date() });
    A.run('check_(true)');
    const dg = A.mail.find(m => /Time clock summary/.test(m.subject));
    ok('at its time: one email, everyone with punches this week', dg && /Gwen — today/.test(dg.body) && /Kim — today/.test(dg.body) && /Wila — today/.test(dg.body) && !/Lee/.test(dg.body), dg && dg.body);
    ok('…by email only (no push)', !pushes().some(x => /Time clock summary/.test(x.title)));
    ok('…with what’s waiting for a manager', /Waiting for a manager \(approve on the Now screen\):\nWila: a note \(“Worked an extra 30 min Tuesday night”\) — asked /.test(dg.body) && !/Lee|Gwen: Clock in/.test(dg.body.split('Waiting for a manager')[1]), dg.body);
    const before = A.mail.length; A.run('check_(true)');
    ok('…once a day', A.mail.length === before);

    console.log('\n# payroll Friday');
    // a pay period that starts with this workweek (3 days ago): its payroll Friday is about 10 days from now
    const pa = TCE.addDays(today, -3), pz = TCE.addDays(pa, 13), payFri = TCE.payDayOf(pz);
    await put('meta/tc', { wk: (dow + 4) % 7, ot: 40, thr: [36, 38], early: '', late: '', shift: 0, brk: 20, days: [0, 1, 2, 3, 4, 5, 6], pay: pa, at: new Date() });
    await put('meta/tcAlerts', { emails: ['dr.test@example.com'], topic: '', route: {}, digest: '', test: null, at: new Date() });
    const early = load(cfg, 'records@example.com', { off: TCE.atTime(payFri, '06:50') - Date.now() });
    Object.assign(early.props, A.props);
    early.run('check_(true)');
    ok('payroll Friday before 7 AM: not yet', !early.mail.some(m => /Payroll: /.test(m.body)), early.mail.map(m => m.subject));
    const pf = load(cfg, 'records@example.com', { off: TCE.atTime(payFri, '07:30') - Date.now() });
    Object.assign(pf.props, A.props);
    pf.run('check_(true)');
    const pm = pf.mail.find(m => /Payroll: /.test(m.body)) || { body: '' };
    if (process.env.SHOW) console.log(pm.body);
    ok('7:30 AM: the payroll numbers by email (' + TCE.dayText(payFri) + ')', new RegExp('Payroll: ' + TCE.dayText(pa) + ' – ' + TCE.dayText(pz)).test(pm.body), pf.mail.map(m => m.subject));
    ok('…each person’s regular and overtime hours for the two weeks', /Gwen — 38 h regular, 0 h overtime \(38 h in all\)/.test(pm.body) && /Kim — 40 h regular, 0\.5 h overtime \(40\.5 h in all\): 0\.5 h the week of /.test(pm.body), pm.body);
    ok('…what to fix first (the clock-outs missing)', /Fix these first[^]*Gwen: no clock-out[^]*Wila: no clock-out/.test(pm.body), pm.body);
    ok('…and Lee, who left during the period, marked so (her hours are still owed)', /Lee \(left\) — 40 h regular, 0\.5 h overtime \(40\.5 h in all\)/.test(pm.body), pm.body);
    const n1 = pf.mail.length; pf.run('check_(true)');
    ok('…once', !pf.mail.slice(n1).some(m => /Payroll: /.test(m.body)));

    console.log('\n# nights');
    const night = load(cfg, 'records@example.com', { off: 0 });
    Object.assign(night.props, A.props);
    const tonight = midnight + 26 * H + 10 * 60000 - now; // 2:10 AM tomorrow (well, about: a clock change can move it an hour)
    night.ctx.Date.now = () => Date.now() + tonight;
    const callsBefore = calls(), rn = night.run('tick()');
    ok('2:10 AM: the 5-minute check does nothing (only the first 5 minutes of each half hour)', rn === 'night' && calls() === callsBefore, rn);

    console.log('\n# the time clock off the office network (the office lock)');
    // Wila clocks out, and back in, at the front desk while it wasn't on the office network (she's well under 40 h, so
    // nothing else to say): one alert about her today
    await put('meta/tcAlerts', { emails: ['dr.test@example.com'], topic: 'nlo-clock-test1', route: {}, digest: '', test: null, at: new Date() }); // (push back on)
    const mailsBefore = A.mail.length, pushesBefore = pushes().length;
    // (punches carry the time they reached the server: the script asks only for ones newer than its last check)
    await put('tcPunch/' + pid(), { sid: 'wila', kind: 'out', at: new Date(Date.now() - 30000), src: 'kiosk', by: 'kiosk1', net: 'off' });
    await put('tcPunch/' + pid(), { sid: 'wila', kind: 'in', at: new Date(Date.now() - 20000), src: 'kiosk', by: 'kiosk1', net: 'unk' });
    const rNet = A.run('check_(true)'), mNet = A.mail[A.mail.length - 1] || {};
    ok('two alerts for Wila: off the network, and couldn’t check (each its own)', rNet === '2 alerts sent' && A.mail.length === mailsBefore + 1 && /^The time clock (is off|couldn’t check) the office network \(\+1 more\)$/.test(mNet.subject), [rNet, mNet.subject]);
    ok('…who, when, and what to do', /Wila clocked out at .* at the time-clock computer while it wasn’t on the office network\. The punch is saved and flagged\. If the office’s internet changed, save the new network: Time Clock → Settings → Office network\./.test(mNet.body || '') && /Wila clocked in at .* while the office network couldn’t be checked/.test(mNet.body || ''), mNet.body);
    ok('…by push too', pushes().length === pushesBefore + 2 && pushes().slice(pushesBefore).some(x => x.title === 'The time clock is off the office network') && pushes().slice(pushesBefore).some(x => x.title === 'The time clock couldn’t check the office network'), pushes().slice(pushesBefore));
    await put('tcPunch/' + pid(), { sid: 'wila', kind: 'out', at: new Date(Date.now() - 5000), src: 'kiosk', by: 'kiosk1', net: 'unk' });
    ok('…once a day for each person (another punch of hers it couldn’t check sends nothing new)', A.run('check_(true)') === '0 alerts sent');

    console.log('\n# when something is off');
    await del('meta/tcAlerts');
    const C = load(cfg, 'records@example.com'); C.run('setup()');
    ok('no alert settings yet: nothing sent, and the check-in says so', /No alert settings yet/.test(C.logs.join(' ')) && C.mail.length === 0 && /No alert settings yet/.test((await list('tcBeat'))[0].err));
    await put('meta/tcAlerts', { emails: [], topic: '', route: {}, digest: '', test: null, at: new Date() });
    const rr = C.run('check_(true)');
    ok('no email address and no push: says there’s nowhere to send', /No email address or phone push set/.test(rr), rr);
    await del('tcBots/' + su.localId);
    const D = load(cfg, 'records@example.com');
    let e3 = '';
    for (let i = 0; i < 3; i++) { try { D.run('check_(true)'); } catch (e) { e3 = e.message; } }
    ok('a login Dr. A turned off: the script says to get it again', /Couldn’t read the time clock/.test(e3) && /Get the script/.test(e3), e3);
    ok('…after 3 failures in a row, one warning email to its own mailbox', D.mail.length === 1 && D.mail[0].to === 'records@example.com' && /alerts need a look/.test(D.mail[0].subject), D.mail);
    try { D.run('check_(true)'); } catch (e) { }
    ok('…not a second one the same day', D.mail.length === 1);
    D.run('stop()');
    ok('stop turns the timer off', D.triggers.length === 0);
  } finally { ntfy.kill(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
