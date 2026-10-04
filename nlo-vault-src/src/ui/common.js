/* Shared UI pieces: toasts, dialogs, dates, clipboard, the auto-lock timer, the strength meter. */
import { html, raw, setHTML, esc, $, $$, ic } from '../html.js';
import { strength } from '../gen.js';
import { V, lockMinutes, log } from '../store.js';

/* ---------- toasts ---------- */
export function toast(msg, o) {
  o = o || {};
  const box = $('#toasts'); if (!box) return;
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (o.kind ? ' ' + o.kind : '');
  setHTML(el, html`<span class="tmsg">${msg}</span>${o.action ? html`<button type="button" class="tact">${o.action}</button>` : ''}`);
  box.appendChild(el);
  let gone = false;
  const close = () => { if (gone) return; gone = true; el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (o.action) el.querySelector('.tact').addEventListener('click', () => { close(); o.onAction && o.onAction(); });
  setTimeout(close, o.ms || (o.action ? 7000 : 3600));
  return close;
}
export function errorText(e) {
  const c = (e && e.code) || '';
  if (/network|unavailable|offline/.test(c)) return 'No connection right now. Check the internet and try again.';
  if (/permission-denied/.test(c)) return 'Not allowed — your access may have changed. Reload the vault and try again.';
  if (c === 'changed') return 'Someone else changed this login just now. Close it, look at the new version, then make your change again.';
  if (c === 'no-edit') return 'You can view this folder but not change it.';
  if (c === 'unknown-person') return 'You didn’t add this person (no signature from you), so the vault won’t give them anything. Remove them.';
  if (c === 'same-password') return 'The new password is the same as the current one.';
  if (c === 'name-unknown') return 'This folder’s name couldn’t be read (its key wasn’t made by Dr. A). Open the folder and give it a new key first.';
  if (c === 'no-key') return 'This folder’s key isn’t ready (or wasn’t made by Dr. A). Open the folder to see what to do.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Wait a few minutes and try again.';
  return (e && e.message && !/^Firebase|^\[/.test(e.message) ? e.message : 'Something went wrong') + (c ? ' (' + c + ')' : '');
}

/* ---------- dialogs ---------- */
const stack = [];
export function openModal(content, o) {
  o = o || {};
  const wrap = document.createElement('div');
  wrap.className = 'modalWrap';
  const box = document.createElement('div');
  box.className = 'modal' + (o.wide ? ' wide' : '') + (o.cls ? ' ' + o.cls : '');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  if (o.label) box.setAttribute('aria-label', o.label);
  wrap.appendChild(box);
  $('#modals').appendChild(wrap);
  const prevFocus = document.activeElement;
  const m = {
    el: box, wrap, closed: false, guard: o.guard || null,
    set(h) { setHTML(box, h); },
    async close(force) {
      if (m.closed) return;
      if (!force && m.guard && !(await m.guard())) return;
      m.closed = true; stack.splice(stack.indexOf(m), 1); wrap.remove();
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus(); } catch (e) { }
      o.onClose && o.onClose();
    }
  };
  stack.push(m);
  m.set(content);
  // close on the backdrop only when the press both starts and ends there (dragging out of a field doesn't close it)
  let downOnWrap = false;
  wrap.addEventListener('mousedown', e => { downOnWrap = e.target === wrap; });
  wrap.addEventListener('click', e => { if (e.target === wrap && downOnWrap && !o.sticky) m.close(); });
  box.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b && box.contains(b)) m.close(); });
  // focus the first field, unless the person already clicked into one
  setTimeout(() => { if (box.contains(document.activeElement)) return; const f = box.querySelector('[autofocus], input:not([type=hidden]):not([readonly]), select, textarea, button.primary'); if (f) try { f.focus(); } catch (e) { } }, 30);
  return m;
}
export function topModal() { return stack[stack.length - 1] || null; }
export function closeAllModals() { stack.slice().forEach(m => m.close(true)); }
document.addEventListener('keydown', e => {
  const m = topModal(); if (!m) return;
  if (e.key === 'Escape') { e.preventDefault(); m.close(); }
  else if (e.key === 'Tab') {
    const f = $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]', m.el).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
export function confirmBox(o) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(html`
      <div class="mhead"><h2>${o.title}</h2></div>
      <div class="mbody">${typeof o.body === 'string' ? html`<p>${o.body}</p>` : o.body}</div>
      <div class="mfoot"><button type="button" class="btn" data-no>${o.no || 'Cancel'}</button>
      <button type="button" class="btn ${o.danger ? 'danger' : 'primary'}" data-yes>${o.yes || 'OK'}</button></div>`,
      { label: o.title, onClose: () => { if (!answered) resolve(false); } });
    m.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(false); m.close(true); });
    m.el.querySelector('[data-yes]').addEventListener('click', () => { answered = true; resolve(true); m.close(true); });
  });
}

/* ---------- dates ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== now.getFullYear() ? ', ' + d.getFullYear() : '');
}
export function fmtTime(t) { const d = new Date(t); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + ap; }
export function fmtWhen(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today ' + fmtTime(t);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday ' + fmtTime(t);
  return fmtDate(t);
}
export function ago(t) {
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 45) return days + ' days ago';
  const months = Math.round(days / 30.4);
  if (months < 18) return months + ' months ago';
  return (Math.round(days / 365 * 10) / 10) + ' years ago';
}

/* ---------- clipboard: copies clear themselves after 30 seconds ---------- */
let clearAt = 0, clearPending = false;
export async function copyText(text, what, act) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'offscreen';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (x) { }
    ta.remove();
    if (!ok) { toast('Couldn’t copy — select it and press Ctrl+C', { kind: 'warn' }); return false; }
  }
  if (act) log(act.a, act.o);
  toast(what + ' copied' + (act && act.secret ? ' — it clears from the clipboard in 30 seconds' : ''));
  if (act && act.secret) { clearPending = true; clearAt = Date.now() + 30000; }
  return true;
}
/* empties the clipboard once its 30 seconds are up (browsers only allow it while the vault is the window in front,
   so if someone is pasting elsewhere it happens as soon as they come back) */
export async function clearClipboard(force) {
  if (!clearPending || (!force && Date.now() < clearAt)) return;
  if (!document.hasFocus()) return;
  try { await navigator.clipboard.writeText(''); clearPending = false; } catch (e) { }
}
window.addEventListener('focus', () => clearClipboard());
setInterval(() => clearClipboard(), 2000);

/* ---------- auto-lock ---------- */
let last = Date.now(), lockFn = null, tick = null;
const bump = () => { last = Date.now(); };
['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(ev => window.addEventListener(ev, bump, { passive: true, capture: true }));
export function startIdleLock(onLock, onTick) {
  lockFn = onLock; last = Date.now();
  clearInterval(tick);
  const check = () => {
    const left = lockMinutes() * 60000 - (Date.now() - last);
    if (left <= 0) { clearInterval(tick); lockFn && lockFn('idle'); return; }
    onTick && onTick(left);
  };
  tick = setInterval(check, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}
export function stopIdleLock() { clearInterval(tick); lockFn = null; }

/* ---------- small bits ---------- */
export const FOLDER_CLS = c => 'fc-' + (['navy', 'blue', 'sky', 'mint', 'coral', 'gold', 'gray'].includes(c) ? c : 'gray');
export function initials(s) {
  const w = String(s || '?').replace(/^(https?:\/\/)?(www\.)?/i, '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0][0] + (w.length > 1 ? w[1][0] : w[0][1] || '')).toUpperCase();
}
export function meterHTML(pw, ctx) {
  const s = strength(pw, ctx);
  if (!pw) return html`<div class="meter"><span class="bar"><i class="w0"></i></span><span class="mlabel muted">Strength</span></div>`;
  return html`<div class="meter s${s.score}"><span class="bar"><i class="w${s.score}"></i></span><span class="mlabel">${s.label}</span>${s.tip ? html`<span class="mtip">${s.tip}</span>` : ''}</div>`;
}
export function hostOf(u) {
  const s = String(u || '').trim(); if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch (e) { return s; }
}
/* only plain web addresses open; anything else (javascript:, data:, file:) is refused */
export function safeUrl(u) {
  const s = String(u || '').trim(); if (!s) return '';
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch (e) { return ''; }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
}
export function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export { html, raw, setHTML, esc, $, $$, ic };
