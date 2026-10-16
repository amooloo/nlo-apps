/* =====================================================================
   Settings — who's at this computer, storage locations, who can change
   settings, the AI keys (Dr. A's own account only), photo clean-up and a
   download of everything. Most of it is for Dr. A and the office
   coordinator.
   ===================================================================== */
VIEWS.settings = {
  render() {
    const w = whoNow(), adm = isAdmin(), owner = isOwnerAccount() || S.demo, locs = listOf(S.settings.locations);
    const admins = (Array.isArray(S.settings.invAdmins) && S.settings.invAdmins.length) ? S.settings.invAdmins : DEFAULT_ADMINS;
    let h = '<div class="adminGrid"><div>';
    h += '<div class="card"><div class="cardHd"><h3>This computer</h3></div><div class="cardBd">' +
      '<div class="kvRow"><span>Signed in to Google as</span><b>' + esc((B.user && B.user.email) || '—') + '</b></div>' +
      '<div class="kvRow"><span>Person using it</span><b>' + (w ? esc(w.name) + ' · ' + Math.ceil(whoLeftMs() / 60000) + ' min left' : 'nobody tapped in') + '</b></div>' +
      '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="who">' + ic('user', 15) + (w ? 'Change' : 'Tap your name') + '</button>' + (w ? '<button class="btn btn-ghost btn-sm" data-act="whoOff">Clear the name</button>' : '') + (S.demo ? '' : '<button class="btn btn-ghost btn-sm" data-act="signOut">' + ic('out', 15) + 'Sign this computer out</button>') + '</div>' +
      '<div class="hint">A tapped name stays on this computer for ' + WHO_MINUTES + ' minutes after the last step, then the next step asks again.</div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Storage locations</h3><span class="sub">where things are kept</span></div><div class="cardBd">' +
      (locs.length ? locs.map(l => '<div class="kvRow"><span>' + ic('pin', 13) + ' ' + esc(l) + '</span>' + '<button class="btn btn-ghost btn-sm" data-act="locDel" data-l="' + esc(l) + '">Remove</button>' + '</div>').join('') : '<div class="empty">None yet.</div>') +
      '<div class="inRow" style="margin-top:10px"><input class="inp" id="locNew" placeholder="e.g. Sterilization closet" data-enter="#locAddBtn"><button class="btn btn-sec" id="locAddBtn" data-act="locAdd">Add</button></div><div class="hint">' + esc(adminNames()) + ' can change these.</div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Who can change settings</h3></div><div class="cardBd"><div class="hint" style="margin-top:0">Budget amounts, vendors, storage locations, archiving and deleting supplies, voiding orders and reopening received ones.</div>' +
      (S.people.length ? S.people : FALLBACK_STAFF).map(p => '<label class="chk" style="padding:6px 0"><input type="checkbox" data-chg="adminTick" value="' + esc(p.id) + '"' + (admins.includes(p.id) ? ' checked' : '') + (owner && p.id !== OWNER_ID ? '' : ' disabled') + '> ' + esc(p.name) + '</label>').join('') +
      (owner ? '' : '<div class="hint">Only Dr. A, signed in with his own Google account, can change this list.</div>') + '</div></div>';
    h += caseHelperHTML();
    h += '</div><div>';
    h += '<div class="card"><div class="cardHd"><h3>AI</h3><span class="sub">packing-slip reading and Ask</span></div><div class="cardBd">' + (owner ? aiSettingsHTML() : '<div class="muted small">The AI keys are set by Dr. A from his own Google account. ' + (S.settings.geminiProxyUrl ? 'Reading packing slips goes through the office’s AI service.' : '') + '</div>') + '</div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Email alerts</h3></div><div class="cardBd"><div class="kvRow"><span>Cart, order and receiving emails to Dr. A</span><b>' + (S.settings.alertsOn ? '<span class="stat ok">On</span>' : '<span class="stat off">Off</span>') + '</b></div><div class="hint">Turned on and off from the “NLO Inventory Alerts” script in Dr. A’s Google account. Each email now says who did it.</div></div></div>';
    if (adm) h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Keeping it fast</h3></div><div class="cardBd">' +
      '<div class="kvRow"><span>Supply photos still stored inside the database</span><b>' + items().filter(i => /^data:/.test(i.img || '') || /^data:/.test(i.imgFull || '')).length + '</b></div>' +
      '<div class="kvRow"><span>Packing-slip photos on orders received over a year ago</span><b>' + oldSlipOrders().length + '</b></div>' +
      '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="photoMove">' + ic('upload', 15) + 'Move photos to cloud storage</button><button class="btn btn-ghost btn-sm" data-act="slipClean">Remove old slip photos</button></div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Download</h3></div><div class="cardBd"><div class="hint" style="margin-top:0">Everything Inventory keeps (supplies without photos, orders, vendors, the activity log, the budget), as one file. The database is also backed up every day.</div><div class="btnRow"><button class="btn btn-sec btn-sm" data-act="exportAll">' + ic('download', 15) + 'Download everything</button><button class="btn btn-ghost btn-sm" data-act="exportCsv">Supplies as a spreadsheet (CSV)</button></div></div></div>';
    h += '<div class="card" style="margin-top:18px"><div class="cardBd" style="padding-top:16px"><div class="kvRow"><span>Version</span><b>' + esc(APP_VERSION) + '</b></div><div class="hint">The app before this redesign is kept on the site as a backup copy.</div></div></div>';
    return h + '</div></div>';
  }
};
ACT.locAdd = () => { const n = val('locNew').trim(); if (!n) return; const cur = listOf(S.settings.locations); if (cur.includes(n)) return toast('Already there.'); withAdmin(() => act(() => B.setSetting('locations', cur.concat([n]).sort((a, b) => a.localeCompare(b))), 'Added.'), 'Who’s changing the locations?', 'change storage locations'); };
ACT.locDel = t => { const l = t.dataset.l; withAdmin(async () => { if (!await confirmBox('Remove “' + l + '”?', 'Supplies kept there keep it until they’re edited.', 'Remove', true)) return; act(() => B.setSetting('locations', listOf(S.settings.locations).filter(x => x !== l)), 'Removed.'); }, 'Who’s changing the locations?', 'change storage locations'); };
CHG.adminTick = () => { if (!(isOwnerAccount() || S.demo)) return; const ids = $$('[data-chg="adminTick"]:checked').map(i => i.value); if (!ids.includes(OWNER_ID)) ids.unshift(OWNER_ID); act(() => B.setSetting('invAdmins', ids), 'Saved.'); };
function oldSlipOrders() { return S.D.orders.filter(o => o.slipPhoto && o.status === 'received' && daysAgo(o.dateReceived || o.dateOrdered) > 365); }
ACT.slipClean = () => {
  const list = oldSlipOrders(); if (!list.length) return toast('Nothing to clean up.');
  withAdmin(async () => {
    if (!await confirmBox('Remove ' + list.length + ' old slip photo(s)?', 'From orders received over a year ago. The orders, lines and totals stay; only the photos go. This can’t be undone.', 'Remove the photos', true)) return;
    act(() => Promise.all(list.map(o => B.patchOrder(o.id, { slipPhoto: null }))), 'Removed ' + list.length + ' old photo(s).');
  }, 'Who’s cleaning up?', 'remove old slip photos');
};
/* photos saved inside the database (old supplies) move to Cloud Storage, so every computer stops downloading them with the list */
ACT.photoMove = async t => {
  const list = items().filter(i => /^data:/.test(i.img || '') || /^data:/.test(i.imgFull || ''));
  if (!list.length) return toast('Every photo is already in cloud storage.');
  if (!await confirmBox('Move ' + list.length + ' photo(s) to cloud storage?', 'Keep this page open until it finishes. Every computer stops downloading them with the list.', 'Move them')) return;
  busyBtn(t, true, 'Moving…'); let done = 0, bad = 0;
  for (const it of list) {
    try {
      const patch = {};
      for (const f of ['img', 'imgFull']) {
        const d = it[f]; if (!/^data:image\//.test(d || '')) continue;
        const up = await B.uploadPhoto(it.id, dataUrlToBlob(d), f === 'img' ? 'thumb' : 'full');
        patch[f] = up.url;   /* the field keeps its name and now holds the file's address, as the old optimizer did */
      }
      if (Object.keys(patch).length) await B.patchItem(it.id, patch);
      done++; t.textContent = 'Moving… ' + done + ' of ' + list.length;
    } catch (e) { console.warn('photo move', it.id, e); bad++; }
  }
  busyBtn(t, false); toast('Moved ' + done + ' photo(s)' + (bad ? '; ' + bad + ' couldn’t be moved — try again later.' : '.'), { bad: !!bad });
};
ACT.exportAll = () => {
  const strip = i => { const o = Object.assign({}, i); delete o.img; delete o.imgFull; return o; };
  const data = { exportedAt: nowISO(), by: (whoNow() || {}).short || '', items: S.D.items.map(strip), orders: S.D.orders.map(o => Object.assign({}, o, { slipPhoto: o.slipPhoto ? '(photo)' : null })), vendors: S.D.vendors, log: S.D.log, cart: S.D.cart, budget: S.D.budget, elastoPrices: S.D.elastoPrices };
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
    const ok = await act(() => Promise.all(ids.map(id => {
      const it = itemById(id); if (!it) return null;
      const patch = { buyUnit: 'case', perBuy: n, updatedBy: s.by, updatedAt: s.at };
      if (wasCase) patch.sources = allSources(it).map(x => Object.assign({}, x, { price: countPrice(x) != null ? Math.round(countPrice(x) / n * 10000) / 10000 : x.price }));
      else if (!listOf(it.sources).length && allSources(it).length) patch.sources = allSources(it).map(x => Object.assign({}, x));
      return B.patchItem(id, patch);
    })), 'Done — ' + ids.length + ' suppl' + (ids.length === 1 ? 'y is' : 'ies are') + ' now ordered by the case of ' + n + '.');
    if (!ok) busyBtn(t, false);
  }, 'Who’s changing these?', 'change how supplies are bought');
};
