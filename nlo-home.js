/*
  NLO Apps button: the way back to the NLO Apps home page (index.html), the same in every app.

  Add it to an app with one line, just before </body>:
      <script src="nlo-home.js" defer></script>

  What it does
  - Puts the same "NLO Apps" button in the same spot (the top-left corner) on every screen of the
    app, sign-in and lock screens included. On phones it shortens to "Apps".
  - Steps aside while the app has a dialog open (anything marked aria-modal="true", or a <dialog>
    opened as a modal), the way the app's own header is covered by it; it's back when that closes.
  - Hides itself when the page is printed, and when the page is shown inside another page
    (the transfer calculator inside the Financial Suite, an SOP inside Onboarding).
  - Lives in its own shadow DOM: an app's styles can't change it and it can't change the app.
  - Reads nothing, stores nothing, sends nothing. Works with the encrypted apps' page security
    (it is a same-site file, and it writes no HTML strings).

  Fitting it into an app (each app keeps this in a small <style id="nlo-home-room"> block)
  - While the button is on the page, <html> has the class "nlo-home-on" and two CSS variables:
        --nlo-home-space   room to leave on the left  (the button's right edge + a gap)
        --nlo-home-drop    room to leave at the top   (the button's bottom edge + a gap)
    e.g.  html.nlo-home-on .topbar { padding-left: var(--nlo-home-space); }
  - For a panel or window the app doesn't mark aria-modal, the button can step aside for it too:
          html:has(#myPanel.open) > nlo-home { display: none !important; }
  - <html data-nlo-home="off"> turns the button off for a page.
*/
(function () {
  'use strict';
  if (window.__nloHome) return;            // the line was added twice
  window.__nloHome = true;

  var d = document, root = d.documentElement;
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed || root.getAttribute('data-nlo-home') === 'off') return;

  // The home page sits next to this file, wherever the apps are served from.
  var src = (d.currentScript && d.currentScript.src) || location.href;
  var homeFile, home;
  try {
    homeFile = new URL('index.html', src).href;
    home = /^https?:$/.test(new URL(src).protocol) ? new URL('./', src).href : homeFile;
  } catch (e) { homeFile = home = 'index.html'; }
  var here = location.href.split('#')[0].split('?')[0];
  if (here === home || here === homeFile) return;   // never on the home page itself

  var NAVY = '#1B2F4C';
  var css = [
    ':host{display:block}',
    'a{position:relative;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:30px;margin:0;',
    'padding:0 13px 0 11px;border:0;border-radius:999px;background:' + NAVY + ';color:#fff;',
    'font:600 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    'letter-spacing:.2px;text-transform:none;text-decoration:none;text-shadow:none;white-space:nowrap;cursor:pointer;',
    'box-shadow:0 0 0 1px rgba(255,255,255,.22),0 2px 10px rgba(27,47,76,.28),0 1px 2px rgba(0,0,0,.08);',
    '-webkit-tap-highlight-color:transparent;transition:transform .15s ease,background-color .15s ease,box-shadow .15s ease}',
    // a slightly bigger target than it looks, for fingers
    'a::before{content:"";position:absolute;inset:-6px}',
    'a:hover{background:#2a3f5c;transform:translateX(-2px);box-shadow:0 0 0 1px rgba(255,255,255,.28),0 3px 14px rgba(27,47,76,.32),0 1px 2px rgba(0,0,0,.08)}',
    'a:active{transform:translateX(-1px) scale(.98)}',
    'a:focus{outline:none}',
    'a:focus-visible{outline:2px solid #64F4C9;outline-offset:2px}',
    'svg{flex:none;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}',
    '.short{display:none}',
    '@media (max-width:600px){a{height:28px;padding:0 11px 0 9px;font-size:12px;gap:5px}.long{display:none}.short{display:inline}}',
    '@media print{:host{display:none!important}}',
    '@media (prefers-reduced-motion:reduce){a{transition:none}a:hover,a:active{transform:none}}'
  ].join('');

  var host = d.createElement('nlo-home');
  var hs = host.style;   // where it sits: set through the style object, so no app rule can move it
  hs.setProperty('position', 'fixed', 'important');
  hs.setProperty('top', 'calc(var(--nlo-home-top, 10px) + env(safe-area-inset-top, 0px))', 'important');
  hs.setProperty('left', 'calc(var(--nlo-home-left, 10px) + env(safe-area-inset-left, 0px))', 'important');
  hs.setProperty('z-index', '2147483000', 'important');
  hs.setProperty('margin', '0', 'important');
  hs.setProperty('transform', 'none', 'important');

  var sr = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sr.adoptedStyleSheets = [sheet];
  } catch (e) {
    var st = d.createElement('style');
    st.textContent = css;
    sr.appendChild(st);
  }

  var a = d.createElement('a');
  a.href = home;
  a.title = 'Back to NLO Apps';
  a.setAttribute('aria-label', 'Back to NLO Apps');
  var NS = 'http://www.w3.org/2000/svg';
  var svg = d.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  var path = d.createElementNS(NS, 'path');
  path.setAttribute('d', 'M19 12H5M12 19l-7-7 7-7');
  svg.appendChild(path);
  var long = d.createElement('span'); long.className = 'long'; long.textContent = 'NLO Apps';
  var short = d.createElement('span'); short.className = 'short'; short.textContent = 'Apps';
  a.appendChild(svg); a.appendChild(long); a.appendChild(short);
  sr.appendChild(a);

  // Tell the app how much room the button takes, so its header can leave space for it. While the button
  // is stepped aside for a dialog it has no size, so the last size it had (or its usual size) is used.
  var last = null;
  function measure() {
    var r = a.getBoundingClientRect();
    if (r.width) last = { right: r.right, bottom: r.bottom };
    var m = last || (window.matchMedia && matchMedia('(max-width:600px)').matches ? { right: 80, bottom: 38 } : { right: 116, bottom: 40 });
    root.style.setProperty('--nlo-home-space', Math.ceil(m.right + 12) + 'px');
    root.style.setProperty('--nlo-home-drop', Math.ceil(m.bottom + 10) + 'px');
  }

  // While the app has a dialog open (one marked aria-modal, or a <dialog> opened as a modal), the button
  // steps aside like the app's own header would: you finish or close the dialog, then it's back.
  try {
    var page = new CSSStyleSheet();
    page.replaceSync('html:has([aria-modal="true"]:not([hidden])) > nlo-home{display:none!important}' +
      'html:has(dialog:modal) > nlo-home{display:none!important}');
    d.adoptedStyleSheets = d.adoptedStyleSheets.concat([page]);
  } catch (e) {}

  // It hangs off <html> (not <body>), so an app that redraws its whole page can't remove it.
  // If anything ever removes it, or wipes <html>'s class or style, it puts itself straight back.
  function heal() {
    if (host.parentNode !== root) root.appendChild(host);
    if (!root.classList.contains('nlo-home-on')) root.classList.add('nlo-home-on');
    if (!root.style.getPropertyValue('--nlo-home-space')) measure();
  }
  heal();
  try { new MutationObserver(heal).observe(root, { childList: true, attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
  if (window.ResizeObserver) { try { new ResizeObserver(measure).observe(a); } catch (e) {} }
  window.addEventListener('resize', measure);
})();
