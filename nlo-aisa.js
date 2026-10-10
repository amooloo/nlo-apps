/*
  Ask AISA: the office AI assistant in the corner of every app.

  Add it to an app with one line, just before </body> (next to the NLO Apps button's line):
      <script src="nlo-aisa.js" defer></script>

  What it does
  - A round AISA button sits in the bottom-right corner of every screen. It opens a chat panel
    (a full-screen sheet on phones). "Open full AISA" opens the AI Assistant app in a new tab, for
    photos and the new-hire questions.
  - Answers come from the AISA worker: the same knowledge base, the same answers (and the same
    answer cache) as the AI Assistant app. They stream in as they're written, with the sections they
    came from and tappable follow-up questions. Stock questions ("are we low on gloves?") read the
    live inventory the way the AI Assistant app does.
  - The conversation follows you from app to app in the same browser tab. It's gone when the tab
    closes, or with "New chat".
  - Reads nothing from the app it sits in: only what's typed into AISA is sent.
  - Steps aside while the app has a dialog open (anything marked aria-modal="true", or a <dialog>
    opened as a modal), hides when the page is printed or shown inside another page, and lives in its
    own shadow DOM: app styles can't change it and it can't change the app. Keys typed into it don't
    reach the app's keyboard shortcuts.
  - Builds everything with DOM calls (no HTML strings) and styles through constructed stylesheets,
    so it works under the encrypted apps' page security. A page with its own Content-Security-Policy
    needs these in connect-src:
        https://aisa-worker.akhavan-ak.workers.dev            (the answers)
        https://nlo-inventory-default-rtdb.firebaseio.com     (stock questions; sign-in is *.googleapis.com)
    Questions are also logged to AISA's question log (the same Google Sheet as the AI Assistant app),
    except on pages with their own Content-Security-Policy.
  - Keeps in the browser: the conversation (this tab only, sessionStorage), that the "Ask AISA" hint
    was shown once, and the inventory's anonymous read-only sign-in (localStorage).

  Fitting it into an app
  - While it's on the page, <html> has the class "nlo-aisa-on" and two CSS variables:
        --nlo-aisa-space   room it takes on the right   (the button's left edge + a gap)
        --nlo-aisa-lift    room it takes at the bottom  (the button's top edge + a gap)
  - To move it (e.g. above an app's own bottom bar), set on <html>:  --nlo-aisa-bottom: 72px;
    (default 16px), and --nlo-aisa-right the same way.
  - For a panel or window the app doesn't mark aria-modal, it can step aside for it too:
        html:has(#myPanel.open) > :is(nlo-home, nlo-aisa) { display: none !important; }
  - <html data-nlo-aisa="off"> turns it off for a page.
*/
(function () {
  'use strict';
  if (window.__nloAisa) return;            // the line was added twice
  window.__nloAisa = true;

  var d = document, root = d.documentElement;
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed || root.getAttribute('data-nlo-aisa') === 'off') return;

  var VERSION = '1.0.0';
  var WORKER = 'https://aisa-worker.akhavan-ak.workers.dev';
  var LOG_URL = 'https://script.google.com/macros/s/AKfycbwoohCS5Msft5znpRckxO5ALWxkXrGLMs0Sm3VxYbAk7W5EoC-tpqCLo6GZwO21ZBX3/exec';
  // NLO Inventory (read-only, anonymous sign-in, same project and key as the AI Assistant app)
  var INV_KEY = 'AIzaSyBFCmDgAKkdfZ4Cb81nK0KCKXtONiwMJy4';
  var INV_DB = 'https://nlo-inventory-default-rtdb.firebaseio.com';
  var CHAT_STORE = 'nlo-aisa:chat', SEEN_STORE = 'nlo-aisa:seen', INV_STORE = 'nlo-aisa:inv';
  var MARK = '[[CHOICES]]';
  var MAX_MSGS = 30, MAX_TURNS = 10;
  var EXAMPLES = [
    'How do I seat a patient and what PPE is required?',
    'How many vacation days do I get?',
    'What should I do in a medical emergency?',
    'Are we running low on any supplies?'
  ];

  // The AI Assistant app sits next to this file, wherever the apps are served from.
  var src = (d.currentScript && d.currentScript.src) || location.href;
  var fullApp;
  try { fullApp = new URL('nlo-ai-assistant.html', src).href; } catch (e) { fullApp = 'nlo-ai-assistant.html'; }
  var page = location.pathname.split('/').pop() || 'index.html';
  var pageCsp = !!d.querySelector('meta[http-equiv="Content-Security-Policy" i]');
  // Phones and tablets (a finger is the main pointer): don't pop the keyboard up uninvited.
  function coarse() { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  function focusInput() { if (!coarse()) ta.focus(); }
  var NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ styles */
  var css = [
    ':host{all:initial;display:block;font:400 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    'color:#1B2F4C;-webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-font-smoothing:antialiased}',
    '*,*::before,*::after{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    'button,textarea,a{font:inherit;color:inherit;letter-spacing:normal;text-transform:none}',
    'svg{flex:none;display:block}',

    /* the round button */
    '.fab{position:relative;display:grid;place-items:center;width:52px;height:52px;margin:0;padding:0;border:0;border-radius:50%;cursor:pointer;',
    'background:linear-gradient(145deg,#2A4573,#101D33);color:#fff;-webkit-tap-highlight-color:transparent;',
    'box-shadow:0 0 0 1px rgba(255,255,255,.22),0 6px 18px rgba(16,29,51,.30),0 2px 4px rgba(0,0,0,.10);',
    'transition:transform .15s ease,box-shadow .15s ease}',
    '.fab::before{content:"";position:absolute;inset:-6px;border-radius:50%}',   /* a bigger target than it looks */
    '.fab:hover{transform:translateY(-2px);box-shadow:0 0 0 1px rgba(255,255,255,.28),0 10px 24px rgba(16,29,51,.34),0 2px 4px rgba(0,0,0,.10)}',
    '.fab:active{transform:scale(.96)}',
    '.fab:focus{outline:none}',
    '.fab:focus-visible{outline:2px solid #64F4C9;outline-offset:3px}',
    '.fab .spark{width:28px;height:28px}',
    '.fab .x{display:none;width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.w.open .fab .spark{display:none}',
    '.w.open .fab .x{display:block}',
    '.tip{position:absolute;right:62px;top:50%;transform:translate(6px,-50%);white-space:nowrap;padding:8px 13px;border-radius:999px;',
    'background:#1B2F4C;color:#fff;font-weight:600;font-size:12.5px;line-height:1;letter-spacing:.2px;',
    'box-shadow:0 0 0 1px rgba(255,255,255,.22),0 2px 10px rgba(27,47,76,.28);opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease}',
    '@media (hover:hover){.fab:hover .tip{opacity:1;transform:translate(0,-50%)}}',
    '.fab:focus-visible .tip,.w.hint .tip{opacity:1;transform:translate(0,-50%)}',
    '.w.open .tip{display:none}',

    /* the panel */
    '.panel{position:fixed;z-index:1;display:flex;flex-direction:column;overflow:hidden;background:#fff;border-radius:16px;',
    'right:calc(var(--nlo-aisa-right,16px) + env(safe-area-inset-right,0px));',
    'bottom:calc(var(--nlo-aisa-bottom,16px) + env(safe-area-inset-bottom,0px) + 64px);',
    'width:392px;max-width:calc(100vw - 24px);height:640px;max-height:calc(100vh - 100px);',
    'box-shadow:0 0 0 1px rgba(27,47,76,.10),0 18px 48px rgba(16,29,51,.28),0 4px 12px rgba(16,29,51,.12)}',
    '@supports (height:100dvh){.panel{max-height:calc(100dvh - 100px)}}',
    '.hd{flex:none;display:flex;align-items:center;gap:10px;padding:11px 8px 11px 14px;background:#1B2F4C;color:#fff}',
    '.logo{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#2A4573,#101D33);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}',
    '.logo .spark{width:21px;height:21px}',
    '.ttl{flex:1;min-width:0}',
    '.ttl b{display:block;font-weight:700;font-size:15px;line-height:1.2;letter-spacing:.8px}',
    '.ttl small{display:block;font-size:11.5px;line-height:1.3;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ib{flex:none;display:grid;place-items:center;width:36px;height:36px;margin:0;padding:0;border:0;border-radius:9px;background:transparent;color:#fff;cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent}',
    '.ib:hover{background:rgba(255,255,255,.12)}',
    '.ib:focus{outline:none}',
    '.ib:focus-visible{outline:2px solid #64F4C9;outline-offset:-2px}',
    '.ib svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',

    '.log{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-anchor:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;padding:14px 12px 10px;background:#F7F8F9}',
    '.msg{max-width:90%;padding:9px 12px;border-radius:14px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word}',
    '.u{align-self:flex-end;background:#1B2F4C;color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}',
    '.a{align-self:flex-start;background:#fff;color:#1B2F4C;border:1px solid #DCE0E4;border-bottom-left-radius:4px}',
    '.e{align-self:flex-start;background:#FFF1EE;color:#8A2A1B;border:1px solid #F6C9BF;border-bottom-left-radius:4px}',
    '.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}',
    '.body p{margin:0 0 8px}',
    '.body h3,.body h4{margin:12px 0 5px;font-size:14px;line-height:1.3;font-weight:700;color:#11203A}',
    '.body h3{font-size:14.5px}',
    '.body ul,.body ol{margin:0 0 8px;padding-left:20px}',
    '.body li{margin:2px 0}',
    '.body li>ul,.body li>ol{margin:2px 0 4px}',
    '.body strong{font-weight:700;color:#11203A}',
    '.body code{padding:1px 5px;border-radius:5px;background:#ECEEF0;font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
    '.body a{color:#1D3EA9;text-decoration:underline;text-underline-offset:2px}',
    '.body hr{border:0;border-top:1px solid #ECEEF0;margin:10px 0}',
    '.tw{margin:4px 0 8px;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #DCE0E4;border-radius:8px}',
    '.tw table{border-collapse:collapse;width:100%;font-size:12.5px;line-height:1.35}',
    '.tw th,.tw td{padding:6px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #ECEEF0}',
    '.tw th{background:#F7F8F9;font-weight:700;white-space:nowrap}',
    '.tw tr:last-child td{border-bottom:0}',
    '.pic{display:block;margin:6px 0 8px;text-decoration:none!important;color:#4C5868!important}',
    '.pic img{display:block;max-width:100%;max-height:240px;border-radius:8px;border:1px solid #DCE0E4;background:#fff}',
    '.pic span{display:block;margin-top:3px;font-size:11.5px}',
    '.src{margin-top:8px;padding-top:7px;border-top:1px solid #ECEEF0;font-size:11.5px;line-height:1.4;color:#6B7685}',
    '.src b{color:#4C5868;font-weight:600}',
    '.ch{display:flex;flex-direction:column;gap:6px;margin-top:10px}',
    '.cb{display:block;width:100%;margin:0;padding:8px 11px;border:1px solid #C9D3EA;border-radius:10px;background:#fff;color:#1D3EA9;font-weight:600;font-size:13px;line-height:1.35;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.cb:hover:not(:disabled){background:#EEF2FC;border-color:#AEBDE3}',
    '.cb:focus{outline:none}',
    '.cb:focus-visible{outline:2px solid #1D3EA9;outline-offset:1px}',
    '.cb.other{color:#4C5868;font-weight:500;border-style:dashed}',
    '.cb.chosen{background:#EEF2FC;border-color:#1D3EA9}',
    '.cb:disabled{cursor:default;opacity:.55}',
    '.cb.chosen:disabled{opacity:1}',
    '.retry{margin-top:8px;padding:6px 12px;border:1px solid #E7A698;border-radius:8px;background:#fff;color:#8A2A1B;font-weight:600;font-size:12.5px;cursor:pointer}',
    '.retry:focus-visible{outline:2px solid #8A2A1B;outline-offset:1px}',
    '.hi{padding:14px;border:1px solid #DCE0E4;border-radius:14px;background:#fff}',
    '.hi b{display:block;margin-bottom:3px;font-size:15px;font-weight:700}',
    '.hi p{margin:0 0 11px;color:#4C5868;font-size:13px;line-height:1.45}',
    '.hi .ch{margin-top:0}',
    '.dots{display:inline-flex;gap:4px;padding:5px 2px}',
    '.dots i{width:7px;height:7px;border-radius:50%;background:#969FAB;animation:aisa-b 1.2s infinite ease-in-out}',
    '.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes aisa-b{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',

    '.f{flex:none;display:flex;align-items:flex-end;gap:8px;margin:0;padding:10px 12px 6px;background:#fff;border-top:1px solid #ECEEF0}',
    'textarea{flex:1;min-width:0;display:block;height:42px;min-height:42px;max-height:132px;margin:0;padding:10px 12px;resize:none;overflow-y:auto;',
    'border:1px solid #C3C9D0;border-radius:12px;background:#fff;color:#1B2F4C;font-size:14px;line-height:1.4;outline:none;box-shadow:none}',
    'textarea::placeholder{color:#969FAB;opacity:1}',
    'textarea:focus{border-color:#1D3EA9;box-shadow:0 0 0 3px rgba(29,62,169,.14)}',
    '.send{flex:none;display:grid;place-items:center;width:42px;height:42px;margin:0;padding:0;border:0;border-radius:50%;background:#1B2F4C;color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.send svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.send:hover:not(:disabled){background:#2a3f5c}',
    '.send:disabled{opacity:.35;cursor:default}',
    '.send:focus{outline:none}',
    '.send:focus-visible{outline:2px solid #1D3EA9;outline-offset:2px}',
    '.note{flex:none;margin:0;padding:0 12px 9px;background:#fff;font-size:11px;line-height:1.35;color:#6B7685;text-align:center}',

    /* phones: a smaller button, and the panel is a full-screen sheet */
    '@media (max-width:600px){',
    '.fab{width:48px;height:48px}.fab .spark{width:26px;height:26px}.tip{right:58px}',
    '.panel{top:0;right:0;bottom:0;left:0;width:auto;max-width:none;height:auto;max-height:none;border-radius:0;box-shadow:none}',
    '.w.open .fab{visibility:hidden}',
    '.hd{padding-top:calc(11px + env(safe-area-inset-top,0px));padding-left:calc(14px + env(safe-area-inset-left,0px));padding-right:calc(8px + env(safe-area-inset-right,0px))}',
    'textarea{font-size:16px}',
    '.note{padding-bottom:calc(9px + env(safe-area-inset-bottom,0px))}',
    '}',
    '@media print{:host{display:none!important}}',
    '@media (prefers-reduced-motion:reduce){.fab,.tip{transition:none}.fab:hover,.fab:active{transform:none}.dots i{animation:none;opacity:.7}}'
  ].join('');

  /* ------------------------------------------------------------------ small helpers */
  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function icon(name, cls) {
    var svg = d.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', name === 'spark' ? '0 0 48 48' : '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (cls) svg.setAttribute('class', cls);
    function path(dd, fill) {
      var p = d.createElementNS(NS, 'path');
      p.setAttribute('d', dd);
      if (fill) p.setAttribute('fill', fill);
      svg.appendChild(p);
    }
    if (name === 'spark') {
      // the AI Assistant tile's sparkle (index.html), in its mint / coral
      path('M20.5 11C20.5 20.9 27.1 27.5 37 27.5C27.1 27.5 20.5 34.1 20.5 44C20.5 34.1 13.9 27.5 4 27.5C13.9 27.5 20.5 20.9 20.5 11Z', '#64F4C9');
      path('M36.5 4C36.5 8.5 39.5 11.5 44 11.5C39.5 11.5 36.5 14.5 36.5 19C36.5 14.5 33.5 11.5 29 11.5C33.5 11.5 36.5 8.5 36.5 4Z', '#FF7B63');
    } else if (name === 'x') path('M18 6 6 18M6 6l12 12');
    else if (name === 'new') { path('M3 12a9 9 0 1 0 2.64-6.36L3 8.3'); path('M3 3v5.3h5.3'); }
    else if (name === 'out') { path('M14 4h6v6'); path('M10 14 20 4'); path('M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5'); }
    else if (name === 'send') { path('M12 19V5'); path('m5 12 7-7 7 7'); }
    return svg;
  }
  // localStorage / sessionStorage can throw (site data blocked), so they're only touched inside try.
  function getStore(kind, key) { try { return JSON.parse(window[kind].getItem(key) || 'null'); } catch (e) { return null; } }
  function setStore(kind, key, val) { try { if (val == null) window[kind].removeItem(key); else window[kind].setItem(key, JSON.stringify(val)); } catch (e) {} }
  function strings(a, max) {
    return Array.isArray(a) ? a.filter(function (s) { return typeof s === 'string' && s; }).slice(0, max) : [];
  }

  // Only http(s) links and pictures; never javascript:, data: and the like.
  function safeUrl(u) {
    try {
      var x = new URL(String(u).trim(), location.href);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null;
    } catch (e) { return null; }
  }
  function link(url, text) {
    var a = el('a', null, text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  // A picture from the manuals. Pages with their own Content-Security-Policy only allow pictures from
  // their own site, so anything else becomes a link instead of a broken image (and a console error).
  function picture(url, alt) {
    var cap = (alt || '').trim();
    var sameSite = false;
    try { sameSite = new URL(url).origin === location.origin; } catch (e) {}
    if (pageCsp && !sameSite) return link(url, '📷 ' + (cap || 'Open the picture'));
    var a = link(url, null);
    a.className = 'pic';
    var img = el('img');
    img.alt = cap || 'Reference picture';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', function () {
      clear(a);
      a.className = '';
      a.textContent = '📷 ' + (cap || 'Open the picture');
    });
    img.src = url;
    a.appendChild(img);
    if (cap) a.appendChild(el('span', null, cap));
    return a;
  }

  /* ------------------------------------------------------------------ answers → page (no HTML strings) */
  var INLINE = '!\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)' +          // 1,2 picture
    '|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)' +                     // 3,4 link
    '|\\*\\*([^\\n]+?)\\*\\*' +                                  // 5   bold
    '|`([^`\\n]+)`' +                                           // 6   code
    '|\\*([^*\\s](?:[^*\\n]*[^*\\s])?)\\*' +                     // 7   italic
    '|(https?:\\/\\/[^\\s<>"]+)';                                // 8   bare address
  var IMG_EXT = /\.(?:png|jpe?g|gif|webp)(?:[?#][^\s]*)?$/i;
  var WORDCH = /[A-Za-z0-9]/;

  function inline(text, into) {
    var re = new RegExp(INLINE, 'g'), last = 0, m;
    function txt(s) { if (s) into.appendChild(d.createTextNode(s)); }
    while ((m = re.exec(text))) {
      var at = m.index, end = re.lastIndex, url;
      if (m[2] !== undefined) {
        url = safeUrl(m[2]);
        txt(text.slice(last, at));
        if (url) into.appendChild(picture(url, m[1])); else txt(m[1]);
      } else if (m[4] !== undefined) {
        url = safeUrl(m[4]);
        txt(text.slice(last, at));
        into.appendChild(url ? link(url, m[3]) : d.createTextNode(m[3]));
      } else if (m[5] !== undefined) {
        txt(text.slice(last, at));
        var b = el('strong');
        inline(m[5], b);
        into.appendChild(b);
      } else if (m[6] !== undefined) {
        txt(text.slice(last, at));
        into.appendChild(el('code', null, m[6]));
      } else if (m[7] !== undefined) {
        // *italic* only between word boundaries, so "2 * 3 * 4" and snake*case stay as typed
        if ((at > 0 && WORDCH.test(text.charAt(at - 1))) || WORDCH.test(text.charAt(end))) { re.lastIndex = at + 1; continue; }
        txt(text.slice(last, at));
        var i = el('em');
        inline(m[7], i);
        into.appendChild(i);
      } else {
        var raw = m[8], tail = '';
        // trailing punctuation belongs to the sentence, not the address
        while (/[.,;:!?'")\]]$/.test(raw)) {
          var ch = raw.slice(-1);
          if (ch === ')' && (raw.split('(').length > raw.split(')').length - 1)) break;
          tail = ch + tail;
          raw = raw.slice(0, -1);
        }
        url = safeUrl(raw);
        txt(text.slice(last, at));
        if (url && IMG_EXT.test(raw)) into.appendChild(picture(url, ''));
        else if (url) into.appendChild(link(url, raw));
        else txt(raw);
        txt(tail);
      }
      last = re.lastIndex;
    }
    txt(text.slice(last));
  }

  function isRow(l) { return /^\|.*\|$/.test(l); }
  function isSep(l) { return l.indexOf('|') > -1 && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(l); }
  function cells(l) { return l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }

  function md(source) {
    var frag = d.createDocumentFragment();
    var text = String(source || '').replace(/\r\n?/g, '\n').replace(/\[PHOTO:[^\]]*\]/g, '');
    // Bare Drive thumbnail addresses are noise unless they're in ![caption](address) picture form.
    var keep = [];
    text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, function (x) { keep.push(x); return '\u0000' + (keep.length - 1) + '\u0000'; });
    text = text.replace(/https?:\/\/drive\.google\.com\/thumbnail\?[^\s)]+/g, '');
    text = text.replace(/\u0000(\d+)\u0000/g, function (x, n) { return keep[+n]; });
    var lines = text.split('\n');
    var para = null, list = null, listType = '', item = null;
    function endPara() { para = null; }
    function endList() { list = null; listType = ''; item = null; }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], t = line.trim();
      if (!t) { endPara(); endList(); continue; }
      var h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
      if (h) {
        endPara(); endList();
        var hEl = el(h[1].length <= 3 ? 'h3' : 'h4');
        inline(h[2].replace(/^\*\*(.+)\*\*$/, '$1'), hEl);
        frag.appendChild(hEl);
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) { endPara(); endList(); frag.appendChild(el('hr')); continue; }
      if (isRow(t) && i + 1 < lines.length && isSep(lines[i + 1].trim())) {
        endPara(); endList();
        var wrap = el('div', 'tw'), table = el('table'), thead = el('thead'), tbody = el('tbody'), tr = el('tr');
        cells(t).forEach(function (c) { var th = el('th'); inline(c, th); tr.appendChild(th); });
        thead.appendChild(tr);
        i += 2;
        while (i < lines.length && isRow(lines[i].trim())) {
          var row = el('tr');
          cells(lines[i].trim()).forEach(function (c) { var td = el('td'); inline(c, td); row.appendChild(td); });
          tbody.appendChild(row);
          i++;
        }
        i--;
        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        frag.appendChild(wrap);
        continue;
      }
      var sub = /^[ \t]{2,}(?:[-*•▸►→✓✗]|\d+[.)])\s+(.+)$/.exec(line);
      if (sub && item) {
        var inner = item.lastChild && item.lastChild.nodeName === 'UL' ? item.lastChild : item.appendChild(el('ul'));
        var sli = el('li');
        inline(sub[1], sli);
        inner.appendChild(sli);
        continue;
      }
      var ol = /^(\d+)[.)]\s+(.+)$/.exec(t), ul = ol ? null : /^[-*•▸►→✓✗]\s+(.+)$/.exec(t);
      if (ol || ul) {
        endPara();
        var type = ol ? 'ol' : 'ul';
        if (!list || listType !== type) {
          list = frag.appendChild(el(type));
          listType = type;
          if (ol && +ol[1] > 1) list.start = +ol[1];
        }
        item = el('li');
        inline(ol ? ol[2] : ul[1], item);
        list.appendChild(item);
        continue;
      }
      if (item && /^[ \t]+/.test(line)) {          // an indented line continues the list item
        item.appendChild(el('br'));
        inline(t, item);
        continue;
      }
      endList();
      if (!para) para = frag.appendChild(el('p'));
      else para.appendChild(el('br'));
      inline(t, para);
    }
    return frag;
  }

  // When a question is vague or the manuals don't cover it, the worker ends its answer with
  //   [[CHOICES]]
  //   - A more specific question
  // Those become buttons (plus "Something else…"). While streaming, a marker that's still
  // arriving ("[", "[[CHO"…) is kept off the screen.
  function splitChoices(text, live) {
    text = String(text || '');
    var i = text.indexOf(MARK);
    if (i === -1) {
      if (live) {
        for (var k = Math.min(MARK.length - 1, text.length); k > 0; k--) {
          if (MARK.indexOf(text.slice(-k)) === 0) { text = text.slice(0, -k); break; }
        }
      }
      return { text: text, choices: [] };
    }
    var choices = [];
    if (!live) {
      text.slice(i + MARK.length).split('\n').forEach(function (line) {
        var c = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim();
        if (c && c.indexOf('[[') !== 0 && c.length <= 160 && choices.indexOf(c) === -1 && choices.length < 4) choices.push(c);
      });
    }
    return { text: text.slice(0, i).replace(/\s+$/, ''), choices: choices };
  }

  /* ------------------------------------------------------------------ live inventory (stock questions) */
  // The same test and the same data as the AI Assistant app: only real stock questions read the
  // inventory (it slows the answer and turns off the answer cache).
  function isStockQuestion(text) {
    var lower = text.toLowerCase();
    var stockPhrases = ['inventory', 'in stock', 'out of stock', 'stock level', 'restock', 'reorder', 're-order',
      'running low', 'run low', 'low on', 'ran out', 'run out', 'order more', 'need to order', 'par level',
      'supplies', 'how much stock', 'quantity', 'qty'];
    if (stockPhrases.some(function (p) { return lower.indexOf(p) !== -1; })) return true;
    var askWords = ['do we have', 'how many', 'any left', 'left?', 'on hand', 'enough'];
    var items = ['bracket', 'wire', 'elastic', 'band', 'archwire', 'molar tube', 'tube', 'adhesive', 'ligature',
      'chain', 'separator', 'gloves', 'mask', 'gauze', 'wax', 'fluoride', 'prophy', 'cement', 'primer', 'etch',
      'retainer material', 'aligner material', 'sheets', 'resin', 'bib', 'cotton roll', 'tad', 'screw'];
    return askWords.some(function (w) { return lower.indexOf(w) !== -1; }) && items.some(function (it) { return lower.indexOf(it) !== -1; });
  }

  function formatInventory(items) {
    if (!items) return '\n[INVENTORY DATA: Unable to connect to inventory system right now.]\n';
    var lines = ['\n=== LIVE INVENTORY DATA (from NLO Inventory System) ===\n'];
    var entries = Object.keys(items).map(function (k) { return [k, items[k]]; });
    if (entries.length === 0) return '\n[INVENTORY DATA: No items found in the system.]\n';
    var byCategory = {};
    entries.forEach(function (pair) {
      var key = pair[0], item = pair[1] || {};
      var cat = (item.category || item.Category || 'Uncategorized').toString();
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ id: key, data: item });
    });
    Object.keys(byCategory).sort().forEach(function (cat) {
      lines.push('--- ' + cat + ' ---');
      byCategory[cat].forEach(function (entry) {
        var x = entry.data;
        var name = x.name || x.Name || x.item || x.Item || entry.id;
        var qty = x.quantity !== undefined ? x.quantity : (x.Quantity !== undefined ? x.Quantity : (x.qty !== undefined ? x.qty : (x.count !== undefined ? x.count : '?')));
        var par = x.parLevel || x.ParLevel || x.par || x.Par || '';
        var vendor = x.vendor || x.Vendor || '';
        var line = '  ' + name + ' — Qty: ' + qty;
        if (par) line += ' | Par Level: ' + par;
        if (vendor) line += ' | Vendor: ' + vendor;
        if (typeof qty === 'number' && typeof par === 'number' && qty <= par) line += ' ⚠️ LOW STOCK';
        lines.push(line);
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  // Anonymous, read-only sign-in to the inventory (Firebase's REST endpoints, so no Firebase SDK is
  // loaded into the app). The sign-in is kept and refreshed, like the AI Assistant app's.
  var inv = { items: null, at: 0 };
  function invToken(fresh) {
    var saved = getStore('localStorage', INV_STORE);
    if (!fresh && saved && saved.id && saved.exp - Date.now() > 120000) return Promise.resolve(saved.id);
    function keep(id, rt, secs) {
      var v = { id: id, rt: rt, exp: Date.now() + (parseInt(secs, 10) || 3600) * 1000 };
      setStore('localStorage', INV_STORE, v);
      return v.id;
    }
    function signUp() {
      return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + INV_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}'
      }).then(function (r) {
        if (!r.ok) throw new Error('Inventory sign-in failed (' + r.status + ')');
        return r.json();
      }).then(function (j) { return keep(j.idToken, j.refreshToken, j.expiresIn); });
    }
    if (saved && saved.rt) {
      return fetch('https://securetoken.googleapis.com/v1/token?key=' + INV_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(saved.rt)
      }).then(function (r) {
        if (!r.ok) throw new Error('refresh ' + r.status);
        return r.json();
      }).then(function (j) { return keep(j.id_token, j.refresh_token, j.expires_in); })
        .catch(signUp);
    }
    return signUp();
  }
  function fetchInventory() {
    if (inv.items && Date.now() - inv.at < 5 * 60 * 1000) return Promise.resolve(inv.items);
    function read(fresh) {
      return invToken(fresh).then(function (tok) {
        return fetch(INV_DB + '/nlo/items.json?auth=' + encodeURIComponent(tok));
      }).then(function (r) {
        if ((r.status === 401 || r.status === 403) && !fresh) return read(true);
        if (!r.ok) throw new Error('Inventory read failed (' + r.status + ')');
        return r.json().then(function (items) {
          inv.items = items || {};
          inv.at = Date.now();
          return inv.items;
        });
      });
    }
    return read(false).catch(function (e) {
      try { console.warn('AISA: live inventory unavailable —', e && e.message || e); } catch (x) {}
      return inv.items;                     // last good copy, or null ("Unable to connect")
    });
  }

  /* ------------------------------------------------------------------ talking to AISA */
  function userError(msg) { var e = new Error(msg); e.user = true; return e; }
  function parseSources(h) {
    if (!h) return [];
    try { return strings(JSON.parse(decodeURIComponent(h)), 3); } catch (e) { return []; }
  }
  function errorText(j, status) {
    var e = j && (j.error && j.error.message || j.message || j.error);
    return typeof e === 'string' && e ? e : 'AISA had a problem answering (' + status + '). Try again in a minute.';
  }

  // Streams from /ask-stream; falls back to /ask (once) the way the AI Assistant app does.
  function getAnswer(body, signal, onText) {
    var fellBack = false;
    function viaAsk() {
      fellBack = true;
      return fetch(WORKER + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: signal })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw userError(errorText(j, r.status));
            if (j.answer == null || j.answer === '') throw userError('AISA sent back an empty answer. Try asking another way.');
            var full = String(j.answer);
            var ch = strings(j.choices, 4);
            if (ch.length) full += '\n\n' + MARK + '\n- ' + ch.join('\n- ');
            return { text: full, sources: strings(j.sources, 3) };
          });
        });
    }
    return fetch(WORKER + '/ask-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: signal })
      .then(function (r) {
        var type = r.headers.get('content-type') || '';
        if (r.ok && r.body && type.indexOf('text/plain') !== -1) {
          var sources = parseSources(r.headers.get('X-AISA-Sources'));
          var reader = r.body.getReader(), dec = new TextDecoder(), full = '';
          var pump = function () {
            return reader.read().then(function (c) {
              if (c.done) {
                full += dec.decode();
                return full.trim() ? { text: full, sources: sources } : viaAsk();
              }
              full += dec.decode(c.value, { stream: true });
              if (full) onText(full);
              return pump();
            });
          };
          return pump();
        }
        // AISA's own "slow down" / "too long" answers are final; anything else gets a second try on /ask.
        if (r.status === 429 || r.status === 400) {
          return r.json().catch(function () { return {}; }).then(function (j) { throw userError(errorText(j, r.status)); });
        }
        return viaAsk();
      })
      .catch(function (e) {
        if (fellBack || (e && (e.user || e.name === 'AbortError'))) throw e;
        return viaAsk();                  // no stream, or it broke part-way: get the whole answer instead
      });
  }

  // The same question log as the AI Assistant app (Google Sheet). Pages with their own
  // Content-Security-Policy block it, so it isn't tried there.
  function logQuestion(question, answer) {
    if (pageCsp) return;
    try {
      fetch(LOG_URL, {
        method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'question', question: question, answer: answer || '', timestamp: new Date().toISOString(), mode: 'widget:' + page })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ state */
  var S = { open: false, busy: false, msgs: [], history: [], ctrl: null, warmed: false };
  (function restore() {
    var v = getStore('sessionStorage', CHAT_STORE);
    if (!v || !Array.isArray(v.msgs) || Date.now() - (v.at || 0) > 12 * 3600 * 1000) return;
    S.msgs = v.msgs.filter(function (m) {
      return m && (m.r === 'u' || m.r === 'a') && typeof m.t === 'string' && m.t;
    }).slice(-MAX_MSGS).map(function (m) {
      return { r: m.r, t: m.t, src: strings(m.src, 3), ch: strings(m.ch, 4) };
    });
    while (S.msgs.length && S.msgs[S.msgs.length - 1].r === 'u') S.msgs.pop();   // its answer never came
    S.history = Array.isArray(v.history) ? v.history.filter(function (h) {
      return h && (h.role === 'user' || h.role === 'model') && Array.isArray(h.parts);
    }).slice(-MAX_TURNS) : [];
  })();
  function save() {
    var msgs = S.msgs.filter(function (m) { return (m.r === 'u' || m.r === 'a') && !m.live; }).slice(-MAX_MSGS)
      .map(function (m) { return { r: m.r, t: m.t, src: m.src || [], ch: m.ch || [] }; });
    setStore('sessionStorage', CHAT_STORE, msgs.length ? { at: Date.now(), msgs: msgs, history: S.history.slice(-MAX_TURNS) } : null);
  }

  /* ------------------------------------------------------------------ the button and the panel */
  var host = d.createElement('nlo-aisa');
  var hs = host.style;   // where it sits: set through the style object, so no app rule can move it
  hs.setProperty('position', 'fixed', 'important');
  hs.setProperty('right', 'calc(var(--nlo-aisa-right, 16px) + env(safe-area-inset-right, 0px))', 'important');
  hs.setProperty('bottom', 'calc(var(--nlo-aisa-bottom, 16px) + env(safe-area-inset-bottom, 0px))', 'important');
  hs.setProperty('left', 'auto', 'important');
  hs.setProperty('top', 'auto', 'important');
  hs.setProperty('z-index', '2147483001', 'important');   // just above the NLO Apps button, so the phone sheet covers it
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

  var w = el('div', 'w');

  var fab = el('button', 'fab');
  fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-controls', 'aisa-panel');
  fab.appendChild(icon('spark', 'spark'));
  fab.appendChild(icon('x', 'x'));
  fab.appendChild(el('span', 'tip', 'Ask AISA'));

  var panel = el('section', 'panel');
  panel.id = 'aisa-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'aisa-title');

  var hd = el('div', 'hd');
  var logo = el('span', 'logo');
  logo.appendChild(icon('spark', 'spark'));
  var ttl = el('div', 'ttl');
  var title = el('b', null, 'AISA');
  title.id = 'aisa-title';
  var subtitle = el('small', null, 'Answers from the NLO manuals');
  ttl.appendChild(title);
  ttl.appendChild(subtitle);
  var bNew = el('button', 'ib');
  bNew.type = 'button';
  bNew.title = 'New chat';
  bNew.setAttribute('aria-label', 'New chat');
  bNew.appendChild(icon('new'));
  var bFull = link(fullApp, null);
  bFull.className = 'ib';
  bFull.rel = 'noopener';
  bFull.title = 'Open the full AISA app (photos, new-hire questions)';
  bFull.setAttribute('aria-label', 'Open the full AISA app in a new tab');
  bFull.appendChild(icon('out'));
  var bClose = el('button', 'ib');
  bClose.type = 'button';
  bClose.title = 'Close';
  bClose.setAttribute('aria-label', 'Close AISA');
  bClose.appendChild(icon('x'));
  hd.appendChild(logo);
  hd.appendChild(ttl);
  hd.appendChild(bNew);
  hd.appendChild(bFull);
  hd.appendChild(bClose);

  var log = el('div', 'log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Conversation with AISA');

  var form = el('form', 'f');
  form.setAttribute('novalidate', '');
  var ta = el('textarea');
  ta.rows = 1;
  ta.placeholder = 'Ask a question…';
  ta.setAttribute('aria-label', 'Your question for AISA');
  ta.setAttribute('enterkeyhint', 'send');
  ta.maxLength = 3800;
  var send = el('button', 'send');
  send.type = 'submit';
  send.title = 'Send';
  send.setAttribute('aria-label', 'Send');
  send.appendChild(icon('send'));
  form.appendChild(ta);
  form.appendChild(send);
  var note = el('p', 'note', 'AI answers — check anything critical with your supervisor. Never type patient names or details.');

  panel.appendChild(hd);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(note);
  w.appendChild(panel);
  w.appendChild(fab);
  sr.appendChild(w);

  /* ------------------------------------------------------------------ drawing the conversation */
  // Messages are drawn once and then updated one at a time (a whole redraw would reload every picture
  // and move the view).
  var paintFrame = 0, autoTop = -1, autoMode = 'bottom';
  function nearBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 60; }
  function toBottom() { autoMode = 'bottom'; log.scrollTop = log.scrollHeight; autoTop = log.scrollTop; }
  // While an answer comes in, its newest words stay in view, but its first line is never scrolled out
  // of sight: a long answer is read from the top while the rest arrives below it. Once the reader
  // scrolls the conversation themselves, it's left where they put it.
  function following() { return Math.abs(log.scrollTop - autoTop) < 6; }
  function follow(m) {
    autoMode = m;
    var box = m && m.node;
    var bottom = log.scrollHeight - log.clientHeight;
    var cap = box && box.parentNode === log ? box.offsetTop - 12 : bottom;
    log.scrollTop = Math.max(0, Math.min(bottom, cap));
    autoTop = log.scrollTop;
  }
  function refollow() {
    if (!following()) return;
    if (autoMode === 'bottom') toBottom(); else follow(autoMode);
  }
  // Pictures arrive after they're drawn: put the view back where it was meant to be.
  log.addEventListener('load', refollow, true);
  log.addEventListener('error', refollow, true);

  function welcomeCard() {
    var c = el('div', 'hi');
    c.appendChild(el('b', null, 'Hi! I’m AISA.'));
    c.appendChild(el('p', null, 'Ask me how we do things at NLO — procedures, policies, benefits, supplies. I answer from the office manuals.'));
    var box = el('div', 'ch');
    EXAMPLES.forEach(function (q) {
      var b = el('button', 'cb', q);
      b.type = 'button';
      b.addEventListener('click', function () { focusInput(); ask(q); });
      box.appendChild(b);
    });
    c.appendChild(box);
    return c;
  }

  function fillAnswer(m, body) {
    clear(body);
    var view = m.live ? splitChoices(m.t, true).text : m.t;
    if (m.live && !view.trim()) {
      var dots = el('span', 'dots');
      dots.setAttribute('aria-label', 'AISA is writing');
      dots.appendChild(el('i'));
      dots.appendChild(el('i'));
      dots.appendChild(el('i'));
      body.appendChild(dots);
    } else body.appendChild(md(view));
  }

  function messageEl(m, isLast) {
    var n;
    if (m.r === 'u') n = el('div', 'msg u', m.t);
    else if (m.r === 'e') {
      n = el('div', 'msg e');
      n.appendChild(el('div', null, m.t));
      if (m.q) {
        var again = el('button', 'retry', 'Try again');
        again.type = 'button';
        again.addEventListener('click', function () { focusInput(); ask(m.q, true); });
        n.appendChild(again);
      }
    } else {
      n = el('div', 'msg a');
      var body = el('div', 'body');
      n.appendChild(body);
      fillAnswer(m, body);
      m.el = body;
      if (!m.live && m.src && m.src.length) {
        var s = el('div', 'src');
        s.appendChild(el('b', null, 'From: '));
        s.appendChild(d.createTextNode(m.src.join(' · ')));
        n.appendChild(s);
      }
      if (!m.live && m.ch && m.ch.length) {
        var box = el('div', 'ch'), open = isLast && !S.busy;
        m.ch.forEach(function (c) {
          var b = el('button', 'cb', c);
          b.type = 'button';
          b.disabled = !open;
          b.addEventListener('click', function () { pick(box, b, c); });
          box.appendChild(b);
        });
        var other = el('button', 'cb other', 'Something else… (type your own)');
        other.type = 'button';
        other.disabled = !open;
        other.addEventListener('click', function () { pick(box, other, null); });
        box.appendChild(other);
        n.appendChild(box);
      }
    }
    m.node = n;
    return n;
  }
  function drop(m) {
    if (m && m.node && m.node.parentNode === log) log.removeChild(m.node);
    if (m) m.node = null;
  }
  function setBusy() {
    log.setAttribute('aria-busy', S.busy ? 'true' : 'false');
    send.disabled = S.busy || !ta.value.trim();
  }

  // The whole conversation, drawn from scratch (first draw, New chat).
  function render() {
    if (paintFrame) { cancelAnimationFrame(paintFrame); paintFrame = 0; }
    clear(log);
    if (!S.msgs.length) log.appendChild(welcomeCard());
    var last = S.msgs.length - 1;
    S.msgs.forEach(function (m, i) { log.appendChild(messageEl(m, i === last)); });
    setBusy();
  }

  // While an answer streams in, only that answer is redrawn (once per frame).
  function paint(m) {
    if (paintFrame) return;
    paintFrame = requestAnimationFrame(function () {
      paintFrame = 0;
      if (!m.el || !m.el.isConnected) return;
      var keep = following();
      fillAnswer(m, m.el);
      if (keep) follow(m);
    });
  }

  function pick(box, btn, text) {
    if (S.busy || btn.disabled) return;
    if (text === null) {                        // "Something else…": type your own
      ta.placeholder = 'Type your question…';
      ta.focus();
      return;
    }
    Array.prototype.forEach.call(box.querySelectorAll('.cb'), function (b) { b.disabled = true; });
    btn.classList.add('chosen');
    focusInput();
    ask(text);
  }

  function ask(question, again) {
    var q = String(question || '').trim().slice(0, 3800);
    if (!q || S.busy) return;
    // a new question: earlier errors and the welcome go, earlier follow-up buttons are finished
    S.msgs.forEach(function (m) { if (m.r === 'e') drop(m); });
    S.msgs = S.msgs.filter(function (m) { return m.r !== 'e'; });
    var hi = log.querySelector('.hi');
    if (hi) log.removeChild(hi);
    Array.prototype.forEach.call(log.querySelectorAll('.cb'), function (b) { b.disabled = true; });
    if (!again) {
      var u = { r: 'u', t: q };
      S.msgs.push(u);
      log.appendChild(messageEl(u, false));
    }
    var a = { r: 'a', t: '', src: [], ch: [], live: true };
    S.msgs.push(a);
    log.appendChild(messageEl(a, true));
    S.busy = true;
    setBusy();
    ta.placeholder = 'Ask a question…';
    toBottom();
    var ctrl = window.AbortController ? new AbortController() : null;
    S.ctrl = ctrl;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, 90000);

    (isStockQuestion(q) ? fetchInventory().then(formatInventory) : Promise.resolve(''))
      .then(function (inventoryData) {
        var body = JSON.stringify({ question: q, inventoryData: inventoryData, history: S.history.slice(-MAX_TURNS), choices: true });
        return getAnswer(body, ctrl && ctrl.signal, function (partial) {
          if (S.ctrl !== ctrl) return;
          a.t = partial;
          paint(a);
        });
      })
      .then(function (res) {
        if (S.ctrl !== ctrl) return;            // "New chat" was pressed meanwhile
        var parts = splitChoices(res.text, false);
        a.t = parts.text.trim() ? parts.text : (parts.choices.length ? 'Which of these do you mean?' : res.text);
        a.ch = parts.choices;
        a.src = res.sources;
        a.live = false;
        S.history.push({ role: 'user', parts: [{ text: q }] }, { role: 'model', parts: [{ text: res.text }] });
        if (S.history.length > MAX_TURNS) S.history = S.history.slice(-MAX_TURNS);
        logQuestion(q, parts.choices.length ? a.t + '\n[Choices] ' + parts.choices.join(' | ') : a.t);
      })
      .catch(function (e) {
        if (S.ctrl !== ctrl) return;
        S.msgs = S.msgs.filter(function (m) { return m !== a; });
        var msg = e && e.user ? e.message
          : timedOut ? 'AISA took too long to answer. Try again in a moment.'
          : 'I couldn’t reach AISA. Check the internet connection and try again.';
        S.msgs.push({ r: 'e', t: msg, q: q });
        try { console.warn('AISA:', e && e.message || e); } catch (x) {}
      })
      .then(function () {
        clearTimeout(timer);
        if (S.ctrl !== ctrl) return;
        if (paintFrame) { cancelAnimationFrame(paintFrame); paintFrame = 0; }
        S.ctrl = null;
        S.busy = false;
        var keep = following(), was = log.scrollTop;
        var ok = S.msgs.indexOf(a) !== -1;
        if (ok) {                               // the finished answer, with its sources and follow-up buttons
          var old = a.node;
          var fresh = messageEl(a, true);
          if (old && old.parentNode === log) log.replaceChild(fresh, old); else log.appendChild(fresh);
        } else {
          drop(a);
          var err = S.msgs[S.msgs.length - 1];
          if (err && err.r === 'e') log.appendChild(messageEl(err, true));
        }
        // a long conversation keeps its last messages (the view stays put while older ones go)
        if (S.msgs.length > MAX_MSGS) {
          var ref = log.lastChild, before = ref ? ref.offsetTop : 0;
          while (S.msgs.length > MAX_MSGS) drop(S.msgs.shift());
          if (ref) was -= before - ref.offsetTop;
        }
        save();
        setBusy();
        if (keep) { if (ok) follow(a); else toBottom(); } else log.scrollTop = was;
        if (S.open && (d.activeElement === host || d.activeElement === d.body)) focusInput();
      });
  }

  function newChat() {
    if (S.ctrl) { try { S.ctrl.abort(); } catch (e) {} }
    S.ctrl = null;
    S.busy = false;
    S.msgs = [];
    S.history = [];
    save();
    ta.value = '';
    grow();
    render();
    toBottom();
    ta.focus();
  }

  function warm() {
    if (S.warmed) return;
    S.warmed = true;
    // Wakes the worker before the first question, and shows the knowledge base's version.
    fetch(WORKER + '/version').then(function (r) { return r.json(); }).then(function (v) {
      if (!v || !v.version) return;
      subtitle.title = 'Knowledge base v' + v.version + (v.lastUpdated ? ', last updated ' + v.lastUpdated : '');
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ opening, closing, typing */
  function phone() { return !!(window.matchMedia && matchMedia('(max-width:600px)').matches); }

  // On phones the panel follows the visible area, so the keyboard never covers the question box.
  function fit() {
    var vv = window.visualViewport;
    if (S.open && vv && phone()) {
      panel.style.setProperty('top', vv.offsetTop + 'px');
      panel.style.setProperty('height', vv.height + 'px');
      panel.style.setProperty('bottom', 'auto');
    } else {
      panel.style.removeProperty('top');
      panel.style.removeProperty('height');
      panel.style.removeProperty('bottom');
    }
  }

  function setOpen(open, refocus) {
    S.open = !!open;
    w.classList.toggle('open', S.open);
    w.classList.remove('hint');
    panel.hidden = !S.open;
    fab.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    fab.setAttribute('aria-label', S.open ? 'Close AISA' : 'Ask AISA, the office assistant');
    fab.title = S.open ? 'Close AISA' : 'Ask AISA';
    fit();
    if (S.open) {
      warm();
      var last = S.msgs[S.msgs.length - 1];
      if (last && last.r === 'a' && !last.live) follow(last); else toBottom();
      focusInput();
    } else if (refocus) fab.focus();
  }

  function grow() {
    ta.style.setProperty('height', 'auto');
    ta.style.setProperty('height', Math.max(42, Math.min(ta.scrollHeight + 2, 132)) + 'px');
    send.disabled = S.busy || !ta.value.trim();
  }

  fab.addEventListener('click', function () { setOpen(!S.open, false); });
  bClose.addEventListener('click', function () { setOpen(false, true); });
  bNew.addEventListener('click', newChat);
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else submit(e);
    }
  });
  function submit(e) {
    if (e) e.preventDefault();
    var q = ta.value.trim();
    if (!q || S.busy) return;
    ta.value = '';
    grow();
    ask(q);
  }
  form.addEventListener('submit', submit);

  // Keys typed into AISA stay in AISA: the app behind it never sees them as its keyboard shortcuts.
  // Escape closes the panel.
  ['keydown', 'keyup', 'keypress'].forEach(function (type) {
    w.addEventListener(type, function (e) {
      if (type === 'keydown' && e.key === 'Escape' && S.open) {
        e.preventDefault();
        setOpen(false, true);
      }
      e.stopPropagation();
    });
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fit);
    visualViewport.addEventListener('scroll', fit);
  }

  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-label', 'Ask AISA, the office assistant');
  fab.title = 'Ask AISA';
  render();

  /* ------------------------------------------------------------------ fitting into the page */
  // Tell the app how much room the button takes, so it can keep its own things clear of it.
  var lastBox = null;
  function measure() {
    var r = fab.getBoundingClientRect();
    if (r.width) lastBox = { left: r.left, top: r.top, vw: window.innerWidth, vh: window.innerHeight };
    var m = lastBox || { left: window.innerWidth - (phone() ? 64 : 68), top: window.innerHeight - (phone() ? 64 : 68), vw: window.innerWidth, vh: window.innerHeight };
    root.style.setProperty('--nlo-aisa-space', Math.ceil(m.vw - m.left + 12) + 'px');
    root.style.setProperty('--nlo-aisa-lift', Math.ceil(m.vh - m.top + 12) + 'px');
  }

  // While the app has a dialog open (one marked aria-modal, or a <dialog> opened as a modal), AISA
  // steps aside the way the NLO Apps button does; the conversation is still there when it's back.
  try {
    var pageSheet = new CSSStyleSheet();
    pageSheet.replaceSync('html:has([aria-modal="true"]:not([hidden])) > nlo-aisa{display:none!important}' +
      'html:has(dialog:modal) > nlo-aisa{display:none!important}' +
      'html[data-nlo-aisa="off"] > nlo-aisa{display:none!important}');
    d.adoptedStyleSheets = d.adoptedStyleSheets.concat([pageSheet]);
  } catch (e) {}

  // It hangs off <html> (not <body>), so an app that redraws its whole page can't remove it.
  // If anything ever removes it, or wipes <html>'s class or style, it puts itself straight back.
  function heal() {
    if (host.parentNode !== root) root.appendChild(host);
    if (!root.classList.contains('nlo-aisa-on')) root.classList.add('nlo-aisa-on');
    if (!root.style.getPropertyValue('--nlo-aisa-space')) measure();
  }
  heal();
  try { new MutationObserver(heal).observe(root, { childList: true, attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
  if (window.ResizeObserver) { try { new ResizeObserver(measure).observe(fab); } catch (e) {} }
  window.addEventListener('resize', function () { measure(); fit(); });

  // The first time this browser sees it, say what it is (once).
  if (!getStore('localStorage', SEEN_STORE)) {
    setStore('localStorage', SEEN_STORE, 1);
    setTimeout(function () {
      if (S.open) return;
      w.classList.add('hint');
      setTimeout(function () { w.classList.remove('hint'); }, 5000);
    }, 1200);
  }

  window.NLO_AISA = { version: VERSION, open: function () { setOpen(true); }, close: function () { setOpen(false); }, ask: function (q) { setOpen(true); ask(q); } };
})();
