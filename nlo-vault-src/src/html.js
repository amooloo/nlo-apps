/* Safe HTML: every value put into a template is escaped unless it was built by this same template tag.
   The page's security policy also requires "Trusted Types", so the only way to put HTML on the page is setHTML(). */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"'`]/g, c => ESC[c]);
function part(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}
const policy = typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy
  ? window.trustedTypes.createPolicy('nlovault', { createHTML: s => s }) : null;
export function setHTML(el, h) {
  const s = h instanceof Raw ? h.s : esc(h);
  el.innerHTML = policy ? policy.createHTML(s) : s;
}
/* parse pasted HTML into a detached document (nothing in it runs or loads); used only to read tables out of a paste */
export function parseDoc(s) {
  return new DOMParser().parseFromString(policy ? policy.createHTML(String(s)) : String(s), 'text/html');
}
export function $(sel, root) { return (root || document).querySelector(sel); }
export function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* icons (24×24, stroke) */
const P = {
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><path d="M12 14.6v2.2"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14.5 8.5l2 2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.7M6.2 7.6A16 16 0 0 0 2.5 12S6 18 12 18c1.5 0 2.9-.4 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ext: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18V7.5A1.5 1.5 0 0 1 5.5 6H10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.8" cy="6.5" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17.5" r=".9"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.2c2 .7 3.5 2.6 3.5 5.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
  activity: '<path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>',
  shield: '<path d="M12 3.5l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V6.3z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.2M12 17.2v.2"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  edit: '<path d="M15.5 5l3.5 3.5L9 18.5H5.5V15z"/><path d="M13.5 7l3.5 3.5"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  download: '<path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4.5 15v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  wand: '<path d="M5 19L16 8"/><path d="M14.5 6.5l3 3"/><path d="M18 3v3M16.5 4.5h3M6 5v2M5 6h2M19 15v2M18 16h2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.2l2.8 1.8"/>',
  move: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/>',
  print: '<path d="M7 9V4.5h10V9"/><rect x="4" y="9" width="16" height="7.5" rx="1.6"/><path d="M7 14h10v5.5H7z"/>',
  text: '<path d="M5 6.5h14M12 6.5v12"/>',
  logout: '<path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8v.2"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  call: '<path d="M5.5 4h3l1.5 4-2 1.3a10 10 0 0 0 6.7 6.7L16 14l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 4 5.6 1.5 1.5 0 0 1 5.5 4z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.5"/>',
  broken: '<path d="M9 7.5 7.4 5.9a3.5 3.5 0 0 0-5 5l2.3 2.3a3.5 3.5 0 0 0 4.6.3M15 16.5l1.6 1.6a3.5 3.5 0 0 0 5-5l-2.3-2.3a3.5 3.5 0 0 0-4.6-.3M8 3v2.5M3 8h2.5M16 21v-2.5M21 16h-2.5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>'
};
export function ic(name, cls) {
  return raw('<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>');
}
