/* =====================================================================
   Vendors — accounts, websites, phone numbers and reps. The built-in
   list (data.js) is laid under what's saved in nlo/vendors, as before.
   Removing a vendor marks it deleted (so it never comes back from the
   built-in list); old orders keep its name.
   ===================================================================== */
const VENDOR_FIELDS = [['name', 'Name'], ['acct', 'Account #'], ['portal', 'Website (where you order)'], ['phone', 'Phone'], ['tollFree', 'Toll-free'], ['email', 'Order email'], ['rep', 'Rep'], ['repPhone', 'Rep mobile'], ['repEmail', 'Rep email'], ['address', 'Address'], ['note', 'Notes']];
VIEWS.vendors = {
  actions() { return '<button class="btn btn-teal" data-act="vendorNew">' + ic('plus', 16) + 'New vendor</button>'; },
  render() {
    let list = S.D.vendors.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (S.q) list = list.filter(v => matchesAll(VENDOR_FIELDS.map(([k]) => v[k] || '').join(' '), S.q));
    const spent = {}, last = {};
    S.D.orders.forEach(o => { if (o.status === 'received' && daysAgo(o.dateReceived) <= 365) spent[o.vendor] = (spent[o.vendor] || 0) + orderTotal(o); const t = msOf(o.orderedAt || o.dateOrdered); if (t > (last[o.vendor] || 0)) last[o.vendor] = t; });
    if (!list.length) return '<div class="card"><div class="empty">No vendor matches.</div></div>';
    return '<div class="adminGrid">' + list.map(v => {
      const tel = v.tollFree || v.phone;
      return '<div class="card"><div class="cardHd">' + vlogoHTML(v, 'lg') + '<div style="flex:1;min-width:0"><h3 style="text-transform:none;letter-spacing:.01em;font-size:16px">' + esc(v.name || 'Vendor') + '</h3><div class="muted small">' + (v.acct ? 'Account ' + esc(v.acct) : 'No account # saved') + (last[v.name] ? ' · last ordered ' + esc(fmtDate(last[v.name])) : '') + (spent[v.name] ? ' · ' + money(spent[v.name], { whole: true }) + ' in the last year' : '') + '</div></div>' +
        '<button class="iconBtn" data-act="vendorEdit" data-id="' + esc(v.id) + '" aria-label="Edit">' + ic('edit', 17) + '</button></div><div class="cardBd">' +
        (v.portal ? '<div class="kvRow"><span>Website</span><a href="' + esc(v.portal) + '" target="_blank" rel="noopener">' + esc(v.portal.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></div>' : '') +
        (tel ? '<div class="kvRow"><span>Phone</span><a href="tel:' + esc(tel.replace(/[^\d+]/g, '')) + '">' + esc(tel) + '</a></div>' : '') +
        (v.email ? '<div class="kvRow"><span>Email</span><a href="mailto:' + esc(v.email) + '">' + esc(v.email) + '</a></div>' : '') +
        (v.rep ? '<div class="kvRow"><span>Rep</span><b>' + esc(v.rep) + (v.repPhone ? ' · <a href="tel:' + esc(v.repPhone.replace(/[^\d+]/g, '')) + '">' + esc(v.repPhone) + '</a>' : '') + (v.repEmail ? ' · <a href="mailto:' + esc(v.repEmail) + '">email</a>' : '') + '</b></div>' : '') +
        (v.address ? '<div class="kvRow"><span>Address</span><b style="text-align:right">' + esc(v.address) + '</b></div>' : '') +
        (v.note ? '<div class="hint">' + esc(v.note) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
};
ACT.vendorNew = () => withAdmin(() => openVendorEditor(null), 'Who’s adding the vendor?', 'add or change vendors');
ACT.vendorEdit = t => withAdmin(() => openVendorEditor(t.dataset.id), 'Who’s changing this vendor?', 'add or change vendors');
function openVendorEditor(id) {
  const v = id ? S.D.vendors.find(x => x.id === id) : {};
  openModal('<h3>' + (id ? 'Edit vendor' : 'New vendor') + '</h3><div class="lsub">Saved for every computer.</div><div class="grid2">' +
    VENDOR_FIELDS.map(([k, l]) => field(l, '<input id="vf_' + k + '" value="' + esc(v[k] || '') + '"' + (k === 'portal' ? ' placeholder="https://"' : '') + '>')).join('') + '</div>' +
    '<div class="mFt">' + (id ? '<button class="btn btn-ghost" data-act="vendorDel" data-id="' + esc(id) + '" style="color:var(--coral-700);margin-right:auto">' + ic('trash', 15) + 'Remove</button>' : '') + '<button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="vendorSave" data-id="' + esc(id || '') + '">Save</button></div>', { cls: 'mid' });
}
ACT.vendorSave = t => withAdmin(async () => {
  /* an emptied field is saved as "" (not removed), so a built-in vendor's old value doesn't come back */
  const rec = {}; VENDOR_FIELDS.forEach(([k]) => { rec[k] = val('vf_' + k).trim(); });
  if (!rec.name) return toast('The vendor needs a name.', { bad: true });
  if (rec.portal && !/^https?:\/\//i.test(rec.portal)) rec.portal = 'https://' + rec.portal;
  const s = stamp(), id = t.dataset.id;
  busyBtn(t, true, 'Saving…');
  const ok = await act(() => id ? B.patchVendor(id, Object.assign(rec, { changedBy: s.by, changedAt: s.at })) : B.putVendor(Object.assign({ id: 'v-' + uid(), addedBy: s.by, addedAt: s.at }, rec)), 'Vendor saved.');
  if (ok) closeModal(true); else busyBtn(t, false);
}, 'Who’s changing this vendor?', 'add or change vendors');
ACT.vendorDel = async t => { const v = S.D.vendors.find(x => x.id === t.dataset.id); if (!v || !await confirmBox('Remove ' + v.name + '?', 'It leaves the vendor list. Orders keep its name.', 'Remove', true)) return; withAdmin(async () => { const s = stamp(); if (await act(() => B.patchVendor(v.id, { deleted: true, deletedBy: s.by, deletedAt: s.at }), 'Removed.')) closeModal(true); }, 'Who’s removing the vendor?', 'remove vendors'); };
