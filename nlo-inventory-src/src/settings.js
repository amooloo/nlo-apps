/* =====================================================================
   Settings — who's signed in, storage locations, who can change
   settings, the AI keys and the alert emails (Dr. A), old slip photos,
   and a download of everything. Most of it is for Dr. A and the office
   coordinator.
   ===================================================================== */
VIEWS.settings = {
  render() {
    const w = whoNow(), owner = isOwnerAccount(), locs = listOf(S.settings.locations), admins = adminList();
    let h = '<div class="adminGrid"><div>';
    h += '<div class="card"><div class="cardHd"><h3>Signed in</h3></div><div class="cardBd">' +
      '<div class="kvRow"><span>Person</span><b>' + (w ? esc(w.name) : '—') + '</b></div>' +
      '<div class="kvRow"><span>Changes settings</span><b>' + (isAdmin() ? 'yes' : 'no') + '</b></div>' +
      '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="lock">' + ic('lock', 15) + 'Lock</button></div>' +
      '<div class="hint">Same login as NLO Cases. Inventory locks after ' + idleMinutes() + ' minutes without activity (set in NLO Cases → Team &amp; security), and every step is stamped with the person signed in.</div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Storage locations</h3><span class="sub">where things are kept</span></div><div class="cardBd">' +
      (locs.length ? locs.map(l => '<div class="kvRow"><span>' + ic('pin', 13) + ' ' + esc(l) + '</span>' + '<button class="btn btn-ghost btn-sm" data-act="locDel" data-l="' + esc(l) + '">Remove</button>' + '</div>').join('') : '<div class="empty">None yet.</div>') +
      '<div class="inRow" style="margin-top:10px"><input class="inp" id="locNew" placeholder="e.g. Sterilization closet" data-enter="#locAddBtn"><button class="btn btn-sec" id="locAddBtn" data-act="locAdd">Add</button></div><div class="hint">' + esc(adminNames()) + ' can change these.</div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Who can change settings</h3></div><div class="cardBd"><div class="hint" style="margin-top:0">Budget amounts, vendors, storage locations, archiving and deleting supplies, voiding orders (and bringing them back) and reopening received ones. The database itself holds everyone else to that.</div>' +
      activePeople().map(p => { const isO = p.role === 'owner'; return '<label class="chk" style="padding:6px 0"><input type="checkbox" data-chg="adminTick" value="' + esc(p.id) + '"' + (isO || admins.includes(p.id) ? ' checked' : '') + (owner && !isO ? '' : ' disabled') + '> ' + esc(p.name) + (isO ? ' <span class="muted small">(always)</span>' : '') + '</label>'; }).join('') +
      (owner ? '' : '<div class="hint">Only Dr. A can change this list.</div>') + '</div></div>';
    h += caseHelperHTML();
    h += '</div><div>';
    h += '<div class="card"><div class="cardHd"><h3>AI</h3><span class="sub">packing-slip reading and Ask</span></div><div class="cardBd">' + (owner || S.demo ? aiSettingsHTML() : '<div class="muted small">The AI keys are set by Dr. A. ' + (S.settings.geminiProxyUrl ? 'Reading packing slips goes through the office’s AI service.' : '') + '</div>') + '</div></div>';
    h += alertsCardHTML(owner);
    if (isAdmin()) h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Keeping it fast</h3></div><div class="cardBd">' +
      '<div class="kvRow"><span>Packing-slip photos on orders received over a year ago</span><b>' + oldSlipOrders().length + '</b></div>' +
      '<div class="btnRow"><button class="btn btn-ghost btn-sm" data-act="slipClean">Remove old slip photos</button></div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Download</h3></div><div class="cardBd"><div class="hint" style="margin-top:0">Everything Inventory keeps (supplies without photos, orders, vendors, the activity log, the budget), as one file. The database also keeps 7 days of every change, for a restore.</div><div class="btnRow"><button class="btn btn-sec btn-sm" data-act="exportAll">' + ic('download', 15) + 'Download everything</button><button class="btn btn-ghost btn-sm" data-act="exportCsv">Supplies as a spreadsheet (CSV)</button></div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardBd" style="padding-top:16px"><div class="kvRow"><span>Version</span><b>' + esc(APP_VERSION) + '</b></div>' + (S.moved && S.moved.at ? '<div class="kvRow"><span>Moved from the old Inventory</span><b>' + esc(fmtWhen(S.moved.at)) + '</b></div>' : '') + '<div class="hint">Since the move, the old Inventory’s database holds a copy of the supply numbers for Staff Meeting and AISA (the alert script keeps it up to date) and can no longer be changed from the old page. Its daily backups keep it as it was before the move.</div></div></div>';
    return h + '</div></div>';
  },
  after() { if (isOwnerAccount() && !S.demo && !S.ui.beatAsked) { S.ui.beatAsked = true; B.beat().then(b => { S.ui.beat = b || { none: true }; if (S.view === 'settings') renderView(true); }).catch(() => { }); } }
};
ACT.locAdd = () => { const n = val('locNew').trim(); if (!n) return; const cur = listOf(S.settings.locations); if (cur.includes(n)) return toast('Already there.'); withAdmin(() => act(() => B.setSetting('locations', cur.concat([n]).sort((a, b) => a.localeCompare(b))), 'Added.'), '', 'change storage locations'); };
ACT.locDel = t => { const l = t.dataset.l; withAdmin(async () => { if (!await confirmBox('Remove “' + l + '”?', 'Supplies kept there keep it until they’re edited.', 'Remove', true)) return; act(() => B.setSetting('locations', listOf(S.settings.locations).filter(x => x !== l)), 'Removed.'); }, '', 'change storage locations'); };
CHG.adminTick = () => {
  if (!isOwnerAccount()) return;
  const ids = $$('[data-chg="adminTick"]:checked').map(i => i.value), me = whoNow();
  if (me && !ids.includes(me.id)) ids.unshift(me.id);
  act(() => B.setSetting('invAdmins', ids), 'Saved.');
};

/* ---------- the alert emails (Dr. A): the "NLO Inventory Alerts" script in his Google account ---------- */
function alertsCardHTML(owner) {
  const on = S.settings.alertsOn === true, b = S.ui.beat;
  let h = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Email alerts</h3><span class="sub">cart, orders, receiving</span></div><div class="cardBd">' +
    '<div class="kvRow"><span>Emails to Dr. A when something goes in the cart, an order is placed, received or reopened</span><b>' + (on ? '<span class="stat ok">On</span>' : '<span class="stat off">Off</span>') + '</b></div>';
  if (!owner) return h + '<div class="hint">Dr. A turns these on and off. Each email says who did it.</div></div></div>';
  if (b && !b.none) h += '<div class="kvRow"><span>The alert script last checked</span><b>' + esc(fmtAgo(b.at)) + (b.err ? ' <span class="stat off" title="' + esc(b.err) + '">problem</span>' : '') + '</b></div>' + (b.err ? '<div class="hint" style="color:var(--red)">' + esc(b.err) + '</div>' : '');
  else if (b && b.none) h += '<div class="hint">The alert script hasn’t checked in yet. Get it below and paste it over the old one' + (on ? '' : ' (getting it turns the alerts on)') + '.</div>';
  h += '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="alertsToggle">' + (on ? 'Turn off' : 'Turn on') + '</button><button class="btn btn-pri btn-sm" data-act="alertScript">' + ic('copy', 15) + 'Get the alert script</button></div>' +
    '<details class="help"><summary>How to update the script</summary><ol class="steps small"><li>Press <b>Get the alert script</b> (it copies it, with a login of its own).</li>' +
    '<li>Open your <a href="' + ALERT_SCRIPT_URL + '" target="_blank" rel="noopener noreferrer">NLO Inventory Alerts</a> script, click in <b>Code.gs</b>, select everything (Ctrl+A) and paste over it. Press <b>Save</b>.</li>' +
    '<li>Pick <b>setup</b> next to Run and press <b>Run</b>. The log says what it found. It checks every minute from then on.</li></ol>' +
    '<div class="hint">It also keeps a copy of the supply numbers in the old database, where Staff Meeting’s spending card and AISA’s stock answers read them. Keep the copied script to yourself: it holds its login.</div></details></div></div>';
  return h;
}
ACT.alertsToggle = () => { if (!isOwnerAccount()) return; const on = S.settings.alertsOn === true; act(() => B.setSetting('alertsOn', !on), on ? 'Alerts are off. Nothing is emailed until you turn them back on.' : 'Alerts are on.'); };
ACT.alertScript = async t => {
  if (!isOwnerAccount()) return;
  busyBtn(t, true, 'Getting it…');
  try {
    const r = await fetch(SCRIPT_FILE, { cache: 'no-store' }); if (!r.ok) throw new Error('Couldn’t load the script (' + r.status + ').');
    const text = await r.text(); if (!text.includes('/*INV_CONFIG*/null')) throw new Error('That isn’t the alert script.');
    const bot = await B.makeBot();
    const cfg = { apiKey: B.cfg.apiKey, projectId: B.cfg.projectId, botEmail: bot.email, botPassword: bot.password };
    if (S.emu) Object.assign(cfg, { authBase: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', fsBase: 'http://127.0.0.1:8080/v1', dbUrl: 'http://127.0.0.1:9000', dbNs: 'demo-nlo-cases' });
    const code = text.replace('/*INV_CONFIG*/null', JSON.stringify(cfg));
    S.ui.lastScript = code;
    /* the first time (the script has never checked in): the alerts go on with it — the move leaves them off until then, so a
       pile of them doesn't wait for a script that isn't there yet */
    /* (whether the script has ever checked in is read again now: a copy that ran since this page opened counts) */
    let on = '', b = null;
    try { b = S.ui.beat = (await B.beat()) || { none: true }; } catch (e) { b = null; }
    if (S.settings.alertsOn !== true && b && b.none) { await B.setSetting('alertsOn', true); on = ', and the alerts are on'; }
    try { await navigator.clipboard.writeText(code); toast('The alert script is copied' + on + '. Paste it over the old one in NLO Inventory Alerts, Save, then Run setup.', { ms: 9000 }); }
    catch (e) { openModal('<h3>The alert script</h3><div class="lsub">Copy all of it, paste it over the old one in NLO Inventory Alerts, Save, then Run setup.</div><textarea readonly class="codeBox" rows="10">' + esc(code) + '</textarea><div class="mFt"><button class="btn btn-pri" data-act="closeModal">Done</button></div>', { cls: 'mid' }); }
  } catch (e) { toast(errText(e), { bad: true }); }
  busyBtn(t, false);
};
function oldSlipOrders() { return S.D.orders.filter(o => o.slipPhoto && o.status === 'received' && daysAgo(o.dateReceived || o.dateOrdered) > 365); }
ACT.slipClean = () => {
  const list = oldSlipOrders(); if (!list.length) return toast('Nothing to clean up.');
  withAdmin(async () => {
    if (!await confirmBox('Remove ' + list.length + ' old slip photo(s)?', 'From orders received over a year ago. The orders, lines and totals stay; only the photos go. This can’t be undone.', 'Remove the photos', true)) return;
    act(() => Promise.all(list.map(o => B.patchOrder(o.id, { slipPhoto: null }).then(() => /^pic:/.test(o.slipPhoto) ? B.dropPic(o.slipPhoto) : null))), 'Removed ' + list.length + ' old photo(s).');
  }, '', 'remove old slip photos');
};
ACT.exportAll = () => {
  const strip = i => { const o = Object.assign({}, i); delete o.img; delete o.imgFull; return o; };
  const data = { exportedAt: nowISO(), by: (whoNow() || {}).name || '', items: S.D.items.map(strip), orders: S.D.orders.map(o => Object.assign({}, o, { slipPhoto: o.slipPhoto ? '(photo)' : null })), vendors: S.D.vendors, log: S.D.log, cart: S.D.cart, budget: Object.assign({}, S.D.budget, { expenses: S.D.expenses }), elastoPrices: S.D.elastoPrices };
  downloadText('nlo-inventory-' + todayISO() + '.json', JSON.stringify(data, null, 1), 'application/json');
};
ACT.exportCsv = () => {
  const rows = [['Name', 'Category', 'Group', 'Location', 'On hand', 'Counted in', 'Bought by', 'Per', 'Reorder below', 'Vendor', 'SKU', 'Price per counted unit', 'Price per bought unit', 'Last counted', 'Archived']];
  items().forEach(i => { const s = primarySource(i) || {}, cp = countPrice(s); rows.push([i.name, catLabel(i.cat), i.group || '', i.location || '', i.qty || 0, countUnit(i), buyUnit(i), perBuy(i), i.min || '', s.vendor || '', s.sku || '', cp == null ? '' : cp.toFixed(2), cp == null ? '' : (cp * perBuy(i)).toFixed(2), i.chk ? dayOf(i.chk) : '', i.archived ? 'yes' : '']); });
  downloadText('nlo-supplies-' + todayISO() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
};

/* ---------- gloves (and anything else) bought by the case ----------
   Supplies counted in boxes but bought by the case of 10 were ordered as "boxes", so receiving 2 cases
   added 2 boxes. This sets them up the right way in one go: counted in boxes, bought by the case.
   The saved prices stay per box (as typed before) unless "the saved price is for a whole case". */
function caseCandidates() { return activeItems().filter(i => !buysBigger(i) && /glove/i.test((i.name || '') + ' ' + (i.group || ''))); }
function caseHelperHTML() {
  const list = caseCandidates(), done = activeItems().filter(i => buysBigger(i));
  if (!list.length && !done.length) return '';
  let h = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Bought by the case</h3><span class="sub">counted in boxes, ordered in cases</span></div><div class="cardBd">';
  if (done.length) h += '<div class="hint" style="margin-top:0">Already set up: ' + done.slice(0, 8).map(i => esc(i.name) + ' (' + esc(buyLabel(i).toLowerCase()) + ')').join(', ') + (done.length > 8 ? ' and ' + (done.length - 8) + ' more' : '') + '. Any supply can be changed in its Edit.</div>';
  if (list.length) {
    h += '<div class="hint" style="margin-top:6px">These gloves are still ordered by the box. Tick the ones bought by the case:</div>' +
      list.map(i => { const cp = countPrice(primarySource(i)); return '<label class="chk caseRow"><input type="checkbox" data-case="' + esc(i.id) + '" checked> <span class="grow">' + esc(i.name) + '<small>' + esc(qtyUnit(i.qty || 0, countUnit(i))) + ' on hand' + (cp != null ? ' · ' + money(cp) + ' saved per ' + esc(countUnit(i)) : '') + '</small></span></label>'; }).join('') +
      '<div class="bigRow" style="margin-top:10px">A case holds <input id="caseN" type="number" inputmode="numeric" min="2" step="1" value="10" class="xs" aria-label="Boxes in a case"> ' + esc(unitWord(countUnit(list[0]), 2)) + '</div>' +
      '<label class="chk" style="margin-top:8px"><input type="checkbox" id="caseWasCase"> The saved prices are for a whole case (not one box)</label>' +
      '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="caseApply">Set them up</button></div>';
  }
  return h + '</div></div>';
}
ACT.caseApply = t => {
  const ids = $$('[data-case]:checked').map(i => i.dataset.case), n = Math.round(num(val('caseN'))), wasCase = $('#caseWasCase').checked;
  if (!ids.length) return toast('Tick at least one.', { bad: true });
  if (!(n > 1)) return toast('How many boxes are in a case?', { bad: true });
  withAdmin(async () => {
    busyBtn(t, true, 'Saving…');
    const s = stamp();
    const ok = await act(() => B.patchItems(ids.map(id => {
      const it = itemById(id); if (!it) return null;
      const patch = { buyUnit: 'case', perBuy: n, updatedBy: s.by, updatedAt: s.at };
      if (wasCase) patch.sources = allSources(it).map(x => Object.assign({}, x, { price: countPrice(x) != null ? Math.round(countPrice(x) / n * 10000) / 10000 : x.price }));
      else if (!listOf(it.sources).length && allSources(it).length) patch.sources = allSources(it).map(x => Object.assign({}, x));
      return [id, patch];
    })), 'Done — ' + ids.length + ' suppl' + (ids.length === 1 ? 'y is' : 'ies are') + ' now ordered by the case of ' + n + '.');
    if (!ok) busyBtn(t, false);
  }, '', 'change how supplies are bought');
};
