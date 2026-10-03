/* =====================================================================
   New case / edit form — tap first, type only the patient's name.
   Choices mirror the office's Tally "Appliance submission form" so
   nothing is lost moving off Tally (assistant, scanner, appliance and
   aligner type, lab, initial submission, Dr. A's instructions, extras).
   ===================================================================== */
const PICK = {
  // MARPE has its own case type and steps; tapping it here switches the case to the MARPE tile (wireCaseForm)
  appliances: ['Herbst with Rollo Band', 'Space Closing Herbst', 'MARA', 'MSE', 'MARPE', 'Rapid Palatal Expander (RPE)', 'D2 distalizer', 'Finger spring with no labial bow', 'Hawley retainers', 'Schwartz'],
  labs: ['Specialty Orthodontic Lab', 'Partner Dental Studios', 'In-house (NL Lab)'],
  scanners: ['Allied Star', 'iTero'],
  extras: ['No IPR', 'No elastics'],
  arches: ['Upper', 'Lower'], retKinds: ['TT’s', 'WT’s']
};
/* lab routing from the AISA KB / SOP manual: MSE → Specialty Orthodontic Lab (SOP-CL-020); MARPE → Partner Dental Studios (SOP-CL-029);
   D2 distalizer → in-house, no outside prescription (lab workflow, Layer 3 exception); Herbst, MARA → Specialty; RPE, Schwartz,
   Hawley, finger spring → Partners (KB lab routing) */
const LAB_SPEC = 'Specialty Orthodontic Lab', LAB_PART = 'Partner Dental Studios', LAB_IN = 'In-house (NL Lab)';
const LAB_FOR = { 'Herbst with Rollo Band': LAB_SPEC, 'Space Closing Herbst': LAB_SPEC, 'MARA': LAB_SPEC, 'MSE': LAB_SPEC, 'MARPE': LAB_PART,
  'Rapid Palatal Expander (RPE)': LAB_PART, 'D2 distalizer': LAB_IN, 'Finger spring with no labial bow': LAB_PART, 'Hawley retainers': LAB_PART, 'Schwartz': LAB_PART };
/* Dr. A's instructions: midline, AP and overbite are Maintain / Improve; the rest are picture tiles.
   v = the full instruction saved on the case (same wording as the Tally form), l = the tile's short label */
const GOALS = [{ k: 'midline', l: 'Midline', t: 'midline', ic: 'midline' }, { k: 'ap', l: 'AP', s: 'Class II / III', t: 'AP', ic: 'ap' }, { k: 'ob', l: 'Overbite', t: 'overbite', ic: 'ob' }];
const INSTR = [
  { v: 'Close all remaining residual spaces/gaps', l: 'Close spaces', ic: 'spaces' },
  { v: 'Resolve black triangles', l: 'Black triangles', ic: 'bt' },
  { v: 'Needs settling of posterior occlusion', l: 'Settle posteriors', ic: 'settle' },
  { v: 'Aligners are not tracking well', l: 'Not tracking', ic: 'track' },
  { v: 'Need to change attachment/hooks on one or more teeth', l: 'Change attachments', ic: 'attach' },
  { v: 'No posterior teeth movement', l: 'No posterior movement', ic: 'lock' },
  { v: 'Active retention', l: 'Active retention', ic: 'retain' }
];
/* instruction tiles that only make sense for aligners (hidden for braces; Active retention off for InSmile — Amir, 2 Oct 2026) */
const ALIGNER_ONLY_INSTR = ['Aligners are not tracking well', 'Need to change attachment/hooks on one or more teeth', 'Active retention'];
function goalText(goals) { goals = goals || {}; return GOALS.filter(gl => goals[gl.k]).map(gl => (goals[gl.k] === 'improve' ? 'Improve ' : 'Maintain ') + gl.t); }

/* ---------- pictures (48×48, built from a few tooth shapes; colors come from CSS): Dr. A's instructions and the case types ---------- */
const [INSTR_ICONS, TYPE_ICONS] = (() => {
  const f = n => +n.toFixed(2);
  // upper incisor crown, front view: left x, width w, cervical y c, incisal y e
  const inc = (x, w, c, e) => { const h = e - c, r = Math.min(3.4, w / 3.4);
    return 'M' + f(x + 1.3) + ' ' + c + 'C' + f(x + .2) + ' ' + f(c + h * .3) + ' ' + f(x - .4) + ' ' + f(c + h * .66) + ' ' + f(x) + ' ' + f(e - r)
      + 'Q' + f(x + .4) + ' ' + e + ' ' + f(x + r) + ' ' + e + 'H' + f(x + w - r) + 'Q' + f(x + w - .4) + ' ' + e + ' ' + f(x + w) + ' ' + f(e - r)
      + 'C' + f(x + w + .4) + ' ' + f(c + h * .66) + ' ' + f(x + w - .2) + ' ' + f(c + h * .3) + ' ' + f(x + w - 1.3) + ' ' + c + 'Z'; };
  // incisor that narrows toward the gum on one side (black triangles): side 1 = narrow on the right, -1 = on the left
  const taper = (x, w, c, e, side) => side > 0
    ? 'M' + f(x + 1.3) + ' ' + c + 'H' + f(x + w - 4.2) + 'L' + f(x + w) + ' ' + f(e - 9) + 'V' + f(e - 3.4) + 'Q' + f(x + w - .4) + ' ' + e + ' ' + f(x + w - 3.4) + ' ' + e + 'H' + f(x + 3.4) + 'Q' + f(x + .4) + ' ' + e + ' ' + f(x) + ' ' + f(e - 3.4) + 'C' + f(x - .4) + ' ' + f(c + (e - c) * .6) + ' ' + f(x + .2) + ' ' + f(c + (e - c) * .3) + ' ' + f(x + 1.3) + ' ' + c + 'Z'
    : 'M' + f(x + w - 1.3) + ' ' + c + 'H' + f(x + 4.2) + 'L' + f(x) + ' ' + f(e - 9) + 'V' + f(e - 3.4) + 'Q' + f(x + .4) + ' ' + e + ' ' + f(x + 3.4) + ' ' + e + 'H' + f(x + w - 3.4) + 'Q' + f(x + w - .4) + ' ' + e + ' ' + f(x + w) + ' ' + f(e - 3.4) + 'C' + f(x + w + .4) + ' ' + f(c + (e - c) * .6) + ' ' + f(x + w - .2) + ' ' + f(c + (e - c) * .3) + ' ' + f(x + w - 1.3) + ' ' + c + 'Z';
  // gum over upper teeth: rounded ends, an arc over each tooth, papillae between
  const gum = (teeth, top, apex, pap) => { const L = teeth[0][0] - 4, R = teeth[teeth.length - 1][0] + teeth[teeth.length - 1][1] + 4, rr = Math.min(3, (pap - top) / 2);
    let d = 'M' + f(L + rr) + ' ' + top + 'H' + f(R - rr) + 'Q' + f(R) + ' ' + top + ' ' + f(R) + ' ' + f(top + rr) + 'V' + pap;
    teeth.slice().reverse().forEach(([x, w], i, a) => { const right = x + w + (i === 0 ? 4 : 0), left = x - (i === a.length - 1 ? 4 : 0);
      d += 'L' + f(right) + ' ' + pap + 'Q' + f(x + w / 2) + ' ' + f(2 * apex - pap) + ' ' + f(left) + ' ' + pap; });
    return '<path class="tg" d="' + d + 'V' + f(top + rr) + 'Q' + f(L) + ' ' + top + ' ' + f(L + rr) + ' ' + top + 'Z"/>'; };
  // molar, side view (roots up, crown down; flip = lower molar)
  const MOLAR = 'M3 10C2.6 6 3.2 2.4 5.2.8 6.4-.1 7.6.6 8 2c.6 2.4 1.2 4.4 3 5.2 1.8-.8 2.4-2.8 3-5.2.4-1.4 1.6-2.1 2.8-1.2 2 1.6 2.6 5.2 2.2 9.2 2.6 1.5 3.2 5 2 8-1.5 3.2-3 3-4.5 3-3.5 0-4.5-1.5-5.5-2-1 .5-2 2-5.5 2-1.5 0-3 .2-4.5-3C-.2 15 .4 11.5 3 10z';
  const molar = (x, y, flip, s) => { s = s || 1; return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ' ' + (flip ? -s : s) + ')"><path class="tk" d="' + MOLAR + '"/><path class="tl tt" d="M3 10q8 1.6 16 0"/></g>'; };
  const t = (x, w, c, e) => '<path class="tk" d="' + inc(x, w, c, e) + '"/>';
  // upper central incisors at Dr. A's ideal width-to-height ratio, 75–80% (visible crown: gum line to incisal edge);
  // lower incisors are narrower; black-triangle teeth are triangular (wide at the edge, narrow at the gum)
  const W = (apex, e, r) => f((r || .78) * (e - apex));
  const wS = W(10, 30), xS = f((48 - 2 * wS - 7) / 2), wM = W(9, 30), xM = f((48 - 2 * wM - 1) / 2);
  const wU = W(8, 29), xU = f((48 - 2 * wU - 1) / 2), wL = W(5, 24, .6), xL = f((48 - 2 * wL - 1) / 2);
  const wT = W(8, 28), wA = W(8.5, 32), wB = W(9, 33, .75);
  const instr = {
    spaces: t(xS, wS, 9, 30) + t(xS + wS + 7, wS, 9, 30) + gum([[xS, wS], [xS + wS + 7, wS]], 4.5, 10, 14)
      + '<path class="ta" d="M9 38.5h9.5m-3.2-3.2 3.2 3.2-3.2 3.2M39 38.5h-9.5m3.2-3.2-3.2 3.2 3.2 3.2"/>',
    bt: '<path class="tk" d="' + taper(24 - wB, wB, 10, 33, 1) + '"/><path class="tk" d="' + taper(24, wB, 10, 33, -1) + '"/>'
      + '<path class="td" d="M20.4 12.2h7.2L24 24.6z"/>' + gum([[24 - wB, wB], [24, wB]], 4, 9, 12.2),
    settle: molar(13, .5) + molar(13, 47.5, true)
      + '<path class="ta" d="M6 13.5v7.5m-3-3 3 3 3-3M6 34.5V27m-3 3 3-3 3 3M42 13.5v7.5m-3-3 3 3 3-3M42 34.5V27m-3 3 3-3 3 3"/>',
    track: t(24 - wT / 2, wT, 7, 28) + gum([[24 - wT / 2, wT]], 3.5, 8, 12) + '<g transform="rotate(-9 24 24)"><path class="ts" d="' + inc(24 - wT / 2 - 3.6, wT + 7.2, 15.5, 35.5) + '"/></g>',
    attach: t(7, wA, 7.5, 32) + gum([[7, wA]], 3.5, 8.5, 12.5) + '<rect class="tf" x="' + f(7 + wA / 2 - 4.5) + '" y="17" width="9" height="6.4" rx="1.6"/>'
      + '<circle class="tf" cx="37" cy="35.5" r="8.8"/><path class="tbl" d="M33 34a4.3 4.3 0 0 1 7.5-1.9M41 37a4.3 4.3 0 0 1-7.5 1.9"/><path class="tbf" d="M41.4 29.8v3.5h-3.5zM32.6 41.2v-3.5h3.5z"/>',
    lock: molar(4, 44, true, 1.05) + '<path class="tlk" d="M34.5 31v-3.2a4.5 4.5 0 0 1 9 0V31"/><rect class="tf" x="32" y="30" width="14" height="11.5" rx="2.6"/><circle class="tbf" cx="39" cy="34.8" r="1.6"/><path class="tbl" d="M39 35.8v2.6"/>',
    retain: '<path class="tk" d="M7.5 41C6 21 13 8 24 8s18 13 16.5 33c-.1.9-.8 1.5-1.7 1.5h-4.1c-1 0-1.7-.8-1.6-1.8C34 25 30 16 24 16s-10 9-9.1 24.7c.1 1-.6 1.8-1.6 1.8H9.2c-.9 0-1.6-.6-1.7-1.5z"/>'
      + '<path class="tl tt" d="M11.2 33.5h3.3M10.6 25.5l3.4.9M13.4 17.6l2.9 1.9M19.3 11.5l1.6 3.1M28.7 11.5l-1.6 3.1M34.6 17.6l-2.9 1.9M37.4 25.5l-3.4.9M36.8 33.5h-3.3"/>'
      + '<path class="ta" d="M18.5 30l3.8 3.8 7.4-7.6"/>',
    midline: t(xM, wM, 8, 30) + t(xM + wM + 1, wM, 8, 30) + gum([[xM, wM], [xM + wM + 1, wM]], 3.5, 9, 13) + '<path class="ta tdl" d="M24 2.5v41"/>',
    ap: molar(5, 2.5, false, .9) + molar(23.2, 45.5, true, .9) + '<path class="ta" d="M8 24h32m-3.4-3.4L40 24l-3.4 3.4M11.4 20.6 8 24l3.4 3.4"/>',
    ob: '<g transform="matrix(1 0 0 -1 0 48)">' + t(xL, wL, 4.5, 24) + t(xL + wL + 1, wL, 4.5, 24) + gum([[xL, wL], [xL + wL + 1, wL]], 1.5, 5, 8.2) + '</g>'
      + t(xU, wU, 7, 29) + t(xU + wU + 1, wU, 7, 29) + gum([[xU, wU], [xU + wU + 1, wU]], 2.5, 8, 12)
      + '<path class="ta" d="M44.8 22v8.5m-2.6-2.6 2.6 2.6 2.6-2.6m-5.2-5.9 2.6-2.6 2.6 2.6"/>'
  };
  /* case types: our own drawings. The outside companies show the logos Amir pasted (logos.js) and fall back to the
     tinted aligner drawing; Next Level's own tile uses the office's NL mark (traced from logo-white.png), drawn in black
     on the same grey band as the other tiles (Amir, 2 Oct 2026: "gray and black"). */
  const NL_MARK = 'M4.9 23.97L4.93 9.42L6.49 9.39L8.05 9.35L13.78 18.92C17.3 24.79 19.59 28.49 19.7 28.49C19.86 28.49 19.9 27.32 19.95 18.95L20.01 9.42L21.88 9.42L23.75 9.42L23.78 23.97L23.81 38.52L22.2 38.52L20.58 38.52L14.88 28.98C10.91 22.34 9.12 19.46 8.99 19.48C8.82 19.51 8.79 20.66 8.74 28.99L8.67 38.45L6.77 38.49L4.87 38.52L4.9 23.97ZM31.1 38.35C30.35 38.1 29.65 37.71 29.05 37.21C28.51 36.76 27.68 35.8 27.68 35.62C27.68 35.57 29.86 35.53 32.54 35.53C35.76 35.53 37.4 35.57 37.4 35.65C37.4 35.72 36.98 36.2 36.48 36.71C35.23 37.98 34.32 38.41 32.74 38.47C32.01 38.5 31.42 38.46 31.1 38.35ZM27.61 31.88C27.58 31.8 27.56 26.71 27.58 20.57L27.61 9.42L29.55 9.42L31.48 9.42L31.54 18.58L31.6 27.74L34.53 27.81C36.14 27.84 37.47 27.89 37.49 27.9C37.51 27.91 37.51 28.84 37.49 29.95L37.46 31.98L32.56 32.01C28.71 32.03 27.66 32.01 27.61 31.88ZM36.32 12.34C36.66 10.22 38.78 8.91 40.84 9.55C41.84 9.87 42.78 10.79 43.06 11.73C43.36 12.77 43.34 12.85 42.71 12.85C42.17 12.85 42.16 12.84 42 12.26C41.69 11.17 40.41 10.32 39.42 10.56C38.39 10.8 37.79 11.38 37.51 12.38C37.39 12.83 37.37 12.85 36.81 12.85L36.24 12.85L36.32 12.34Z';
  // four upper front teeth (lateral, central, central, lateral) at the same 75–80% central width-to-height ratio
  const front = (top, cerv, eC, eL, wC, wL, gap) => {
    const x0 = f(24 - gap * 1.5 - wC - wL);
    const T = [[x0, wL, eL], [f(x0 + wL + gap), wC, eC], [f(x0 + wL + gap * 2 + wC), wC, eC], [f(x0 + wL + gap * 3 + 2 * wC), wL, eL]];
    return { T, d: T.map(([x, w, e]) => inc(x, w, cerv, e)).join(''), g: gum(T, top, cerv - 1, cerv + 3.4) };
  };
  const S = front(9, 17, 31.6, 29.6, 12, 9, 1);
  const tray = '<path class="tshO" d="' + S.d + '"/><path class="tshI" d="' + S.d + '"/><path class="tk" d="' + S.d + '"/>' + S.g;
  const HORSE = 'M7.5 41C6 21 13 8 24 8s18 13 16.5 33c-.1.9-.8 1.5-1.7 1.5h-4.1c-1 0-1.7-.8-1.6-1.8C34 25 30 16 24 16s-10 9-9.1 24.7c.1 1-.6 1.8-1.6 1.8H9.2c-.9 0-1.6-.6-1.7-1.5z';
  const types = {
    tray, // clear aligner over the front teeth; the rim takes the tile's tint
    finish: tray + '<path class="tsp" d="M40 1.6c.6 3.4 1.7 4.5 5.1 5.1-3.4.6-4.5 1.7-5.1 5.1-.6-3.4-1.7-4.5-5.1-5.1 3.4-.6 4.5-1.7 5.1-5.1z"/>',
    nl: '<rect class="nlb" width="48" height="48" rx="12"/><path class="nlf" d="' + NL_MARK + '"/>',
    braces: '<path class="tk" d="' + S.d + '"/>' + S.g + '<path class="twr" d="M-1 22.6Q24 25 49 22.6"/>'
      + S.T.map(([x, w]) => '<rect class="tbr" x="' + f(x + w / 2 - 2.8) + '" y="' + (Math.abs(x + w / 2 - 24) < 8 ? 21.3 : 20.7) + '" width="5.6" height="5" rx="1.2"/>').join(''),
    retainer: '<path class="trt" d="' + HORSE + '"/>'
      + '<path class="tl tt2" d="M11.2 33.5h3.3M10.6 25.5l3.4.9M13.4 17.6l2.9 1.9M19.3 11.5l1.6 3.1M28.7 11.5l-1.6 3.1M34.6 17.6l-2.9 1.9M37.4 25.5l-3.4.9M36.8 33.5h-3.3"/>'
      + '<path class="tgl" d="M12 22.5q2.2-6.5 7-10"/>',
    guard: '<path class="tmg" d="M5.5 40.6C4 19.5 11.8 5.5 24 5.5S44 19.5 42.5 40.6c-.1 1.2-1.1 2.1-2.3 2.1h-6.9c-1.3 0-2.3-1.1-2.2-2.4.7-13.5-2-21.3-7.1-21.3s-7.8 7.8-7.1 21.3c.1 1.3-.9 2.4-2.2 2.4H7.8c-1.2 0-2.2-.9-2.3-2.1z"/>'
      + '<path class="tgl tmgl" d="M10 33q-.8-14 6.5-21"/>',
    appl: '<path class="tl tt2 tdl2" d="M9.5 41C8.3 22 14.2 9.5 24 9.5S39.7 22 38.5 41"/>'
      + '<path class="tl" d="M12.6 33.5Q12.5 21 18.2 16.6M35.4 33.5Q35.5 21 29.8 16.6M17 24.6h3M31 24.6h-3"/>'
      + '<rect class="tbd" x="7.6" y="31.8" width="9.2" height="8.8" rx="2.2"/><rect class="tbd" x="31.2" y="31.8" width="9.2" height="8.8" rx="2.2"/>'
      + '<rect class="tsc" x="19.4" y="18.6" width="9.2" height="12" rx="2.4"/><circle class="tbf2" cx="24" cy="24.6" r="1.7"/>'
      + '<path class="ta" d="M6.2 13.8H1.8m1.9-1.9-1.9 1.9 1.9 1.9M41.8 13.8h4.4m-1.9-1.9 1.9 1.9-1.9 1.9"/>',
    // MARPE: the expander body held by four miniscrews, arms to the molar bands, widening the palate
    marpe: '<path class="tl tt2 tdl2" d="M9.5 41C8.3 22 14.2 9.5 24 9.5S39.7 22 38.5 41"/>'
      + '<path class="tl" d="M17.2 27.4Q13 28.8 12.3 32.2M30.8 27.4Q35 28.8 35.7 32.2"/>'
      + '<rect class="tbd" x="7.6" y="31.8" width="9.2" height="8.8" rx="2.2"/><rect class="tbd" x="31.2" y="31.8" width="9.2" height="8.8" rx="2.2"/>'
      + '<rect class="tsc" x="16.6" y="14.4" width="14.8" height="17.4" rx="3.4"/><rect class="tjs" x="21" y="21.5" width="6" height="3.2" rx="1"/>'
      + [[20, 17.8], [28, 17.8], [20, 28.4], [28, 28.4]].map(([x, y]) => '<circle class="tms" cx="' + x + '" cy="' + y + '" r="1.8"/>').join('')
      + '<path class="ta" d="M6.2 13.8H1.8m1.9-1.9-1.9 1.9 1.9 1.9M41.8 13.8h4.4m-1.9-1.9 1.9 1.9-1.9 1.9"/>',
    // lower front teeth standing in a printed model on its base
    models: '<g transform="matrix(1 0 0 -1 0 47)"><path class="tk" d="' + [[5.9, 8.6, 35], [15.5, 8, 34.5], [24.5, 8, 34.5], [33.5, 8.6, 35]].map(([x, w, e]) => inc(x, w, 21, e)).join('') + '"/></g>'
      + '<path class="tst" d="M4.5 25Q24 29.4 43.5 25V30H4.5z"/><path class="tbs" d="M4.5 28.6H43.5V36.8Q43.5 39.8 40.5 39.8H7.5Q4.5 39.8 4.5 36.8z"/><path class="tl tt2" d="M8 34.6h32"/>',
    tooth: '<path class="tk" d="' + inc(14.5, 19, 14, 37.4) + '"/>' + gum([[14.5, 19]], 8, 13, 17.4)
  };
  return [instr, types];
})();
function instrSvg(k) { return '<svg class="isvg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + (INSTR_ICONS[k] || '') + '</svg>'; }
/* a tile's picture: the company's own logo when we have it (pasted by Amir), the picture Amir chose for Appliance and
   MARPE (pics.js: the whole upper arch with the appliance, on the same white plate), otherwise our drawing */
function tileArt(t) {
  const pc = typeof PICS !== 'undefined' && PICS[t.v];
  if (pc) return '<span class="tmed pic"><img data-pic="' + esc(t.v) + '" width="' + pc.w + '" height="' + pc.h + '" alt="" draggable="false"></span>';
  const lg = typeof LOGOS !== 'undefined' && LOGOS[t.v];
  // the picture is set once the form is on the page (wireCaseForm), so no image address sits in this markup
  return '<span class="tmed' + (lg ? ' lg' : '') + '">' + (lg ? '<img data-logo="' + esc(t.v) + '" width="' + lg.w + '" height="' + lg.h + '" alt="" draggable="false">' : typeSvg(t.ic)) + '</span>';
}
function typeSvg(k) { return '<svg class="isvg tsvg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + (TYPE_ICONS[k] || TYPE_ICONS.tooth) + '</svg>'; }
/* ic = drawing, c = tint; a company logo in LOGOS (logos.js) takes the drawing's place */
const TILES = [
  // Finishing aligners is an option under In-house now, not its own tile (Amir, 3 Oct 2026): see FIN below
  { v: 'oliv', l: 'Oliv', s: 'Aligners', ic: 'tray', c: 'mint' }, { v: 'nla', l: 'In-house', s: 'Aligners & finishing · NL Lab', ic: 'nl', c: 'nl' },
  { v: 'retainer', l: 'Retainers', s: 'TT’s / WT’s', ic: 'retainer' }, { v: 'mouthguard', l: 'Mouthguard', s: 'In-house · complimentary', ic: 'guard' }, { v: 'appliance', l: 'Appliance', s: 'Herbst, RPE, MSE…', ic: 'appl' },
  { v: 'angel', l: 'Angel', s: 'Aligners', ic: 'tray', c: 'coral' }, { v: 'ulab', l: 'uLab', s: 'Aligners', ic: 'tray', c: 'amber' }, { v: 'invisalign', l: 'Invisalign', s: 'Aligners', ic: 'tray', c: 'blue' },
  { v: 'insmile', l: 'InSmile', s: 'Braces · Smartwire IDB', ic: 'braces', c: 'navy' }, { v: 'models', l: 'Study models', s: '3D-printed in‑house', ic: 'models' },
  { v: 'marpe', l: 'MARPE', s: 'STL + CBCT · Zoom', ic: 'marpe' },
  /* retired: shown only when editing a case that already is one */
  { v: 'inbrace', l: 'InBrace / Brava', s: 'Lingual', ic: 'tooth', legacy: true },
  { v: 'retreat', l: 'Retreatment', s: 'Review & proposal', ic: 'tooth', legacy: true }, { v: 'misc', l: 'Other (misc.)', s: 'Older or imported case', ic: 'tooth', legacy: true }
];
const ALIGNERISH = ['oliv', 'angel', 'invisalign', 'ulab', 'nla'];
const BRACES = ['insmile', 'inbrace'];
/* tiles that are in-house (NL Lab) aligner cases */
const INHOUSE_TILES = ['nla'];
/* in-house only: "Finishing aligners" is a fourth answer to "Initial submission?" — saved as variant 'finishing' (initial '')
   on the in-house case, as before, so older finishing cases, the board, the set labels and the totals are unchanged */
const FIN = 'fin';
function groupOfTile(v) { return ALIGNERISH.includes(v) ? 'aligner' : BRACES.includes(v) ? 'braces' : v === 'appliance' ? 'appliance' : v === 'marpe' ? 'marpe' : (v === 'retainer' || v === 'mouthguard') ? 'retainer' : v === 'models' ? 'models' : 'other'; }
/* how the submission is labelled on the case: refinement for aligners, digital enhancement for InSmile */
function submissionLabel(v) { return v === 'yes' ? 'Initial submission' : v === 'no' ? 'Refinement' : v === 'mid' ? 'Mid-course correction' : /^de[123]$/.test(v || '') ? 'Digital enhancement ' + v.slice(2) + ' (DE' + v.slice(2) + ')' : ''; }
/* fields added later save '' when empty (not [] or false), so older cases without them don't look edited */
const FORM_KEYS = ['type', 'patient', 'chart', 'detail', 'stage', 'assignee', 'assistant', 'scanner', 'scanDate', 'labDate', 'deliveryDate', 'deliveryTime', 'aligners',
  'initial', 'appliances', 'lab', 'arches', 'retKinds', 'goals', 'instrPicks', 'instrOther', 'instructions', 'extras', 'teeth', 'cc', 'ipr', 'notes', 'titanUrl', 'alU', 'alL',
  'shipToPatient', 'records', 'zoomDate', 'zoomTime', 'tracking', 'labRef', 'atTemplates', 'treatArch'];

/* delivery time: every half hour, 7:00 AM to 7:00 PM (Amir, 2 Oct 2026: "30 mins increments are fine") */
const HALF_HOURS = Array.from({ length: 25 }, (_, i) => { const m = 7 * 60 + i * 30; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); });
function timeSelectHTML(id, v, label) {
  const opts = HALF_HOURS.includes(v || '') || !v ? HALF_HOURS : HALF_HOURS.concat([v]).sort(); // a time saved before keeps showing
  return '<select id="' + id + '" class="dTime" aria-label="' + esc(label) + '"><option value="">Time (optional)</option>' +
    opts.map(t => '<option value="' + t + '"' + (t === v ? ' selected' : '') + '>' + esc(fmtTime(t)) + '</option>').join('') + '</select>';
}

/* ---------- tooth chart (Palmer, 7s to 7s, same teeth as the IPR Tracker) ---------- */
const TEETH_U = ['UR7', 'UR6', 'UR5', 'UR4', 'UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3', 'UL4', 'UL5', 'UL6', 'UL7'];
const TEETH_L = ['LR7', 'LR6', 'LR5', 'LR4', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3', 'LL4', 'LL5', 'LL6', 'LL7'];
const ANTERIORS = ['UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3'];
const POSTERIORS = TEETH_U.concat(TEETH_L).filter(k => !ANTERIORS.includes(k));
const ALL_TEETH = TEETH_U.concat(TEETH_L);
const UPPER_ANT = ANTERIORS.filter(k => k[0] === 'U'), LOWER_ANT = ANTERIORS.filter(k => k[0] === 'L');
const MARKS = [
  { k: 'noatt', l: 'No attachment' }, { k: 'implant', l: 'Implant' }, { k: 'crown', l: 'Crown' }, { k: 'pontic', l: 'Pontic' },
  { k: 'missing', l: 'Missing' }, { k: 'nomove', l: 'Don’t move' }
];
/* "No attachments on…" shortcuts (the teeth they mark) */
const NOATT_SCOPES = [{ v: 'uant', l: 'Upper anteriors', teeth: UPPER_ANT }, { v: 'ant', l: 'All anteriors', teeth: ANTERIORS }, { v: 'all', l: 'All teeth', teeth: ALL_TEETH }, { v: 'pick', l: 'Choose teeth' }];
function sameSet(a, b) { return a.length === b.length && a.every(k => b.includes(k)); }
const isMissing = (t, k) => ((t || {})[k] || []).includes('missing');
function noattScopeOf(t) { // missing teeth don't count against a group
  const on = ALL_TEETH.filter(k => ((t || {})[k] || []).includes('noatt')); if (!on.length) return '';
  const hit = NOATT_SCOPES.find(sc => sc.teeth && sameSet(on, sc.teeth.filter(k => !isMissing(t, k)))); return hit ? hit.v : 'pick';
}
/* teeth object in a fixed order so saved copies compare equal */
function canonTeeth(t) {
  const out = {}; t = t || {};
  ALL_TEETH.forEach(k => { const m = MARKS.map(x => x.k).filter(x => (t[k] || []).includes(x)); if (m.length) out[k] = m; });
  return out;
}
/* a tooth can't be missing and anything else, or an implant and a pontic at once */
function setMark(t, k, mk, on) {
  let a = (t[k] || []).filter(x => x !== mk);
  if (on) {
    if (mk === 'missing') a = [];
    else { a = a.filter(x => x !== 'missing'); if (mk === 'implant') a = a.filter(x => x !== 'pontic'); if (mk === 'pontic') a = a.filter(x => x !== 'implant'); }
    a.push(mk);
  }
  t[k] = a;
}
/* "No attachment: UR3 to UL3, LR3 to LL3" — runs of 3+ neighbours become "to" ranges
   (a dash would read like an IPR contact); whole groups are named */
function teethSummary(t) {
  t = canonTeeth(t); const lines = [];
  const groups = [[ALL_TEETH, 'all teeth'], [ANTERIORS, 'all anteriors (3–3)'], [UPPER_ANT, 'upper anteriors (3–3)'], [LOWER_ANT, 'lower anteriors (3–3)'], [POSTERIORS, 'all posteriors (4–7)']];
  MARKS.forEach(m => {
    const on = ALL_TEETH.filter(k => (t[k] || []).includes(m.k)); if (!on.length) return;
    const grp = groups.find(([list]) => sameSet(on, list)); if (grp) { lines.push(m.l + ': ' + grp[1]); return; }
    const parts = [];
    [TEETH_U, TEETH_L].forEach(arch => {
      let run = [];
      const flush = () => { if (run.length >= 3) parts.push(run[0] + ' to ' + run[run.length - 1]); else parts.push.apply(parts, run); run = []; };
      arch.forEach(k => { if ((t[k] || []).includes(m.k)) run.push(k); else flush(); }); flush();
    });
    lines.push(m.l + ': ' + parts.join(', '));
  });
  return lines.join('\n');
}
/* ---------- the chart: front view, upper roots up, lower roots down.
   Crowns: white; crowned teeth faded yellow; implants grey with a screw instead of a root;
   pontics have no root; missing teeth are a dashed outline. ---------- */
const TOOTH_GEO = { // mm-ish (roots shortened so the chart stays compact): w width, c crown height, r root length
  U1: { w: 8.5, c: 10.4, r: 9.5, k: 'inc' }, U2: { w: 6.6, c: 9, r: 9.2, k: 'inc' }, U3: { w: 7.6, c: 10, r: 12, k: 'can' },
  U4: { w: 7, c: 8.2, r: 9.6, k: 'pm2' }, U5: { w: 6.8, c: 7.8, r: 9.6, k: 'pm' }, U6: { w: 10, c: 7.4, r: 8.6, k: 'mol' }, U7: { w: 9.2, c: 7, r: 8, k: 'mol' },
  L1: { w: 5.2, c: 8.8, r: 9, k: 'inc' }, L2: { w: 5.8, c: 9.2, r: 9.6, k: 'inc' }, L3: { w: 7, c: 10.6, r: 11.6, k: 'can' },
  L4: { w: 7, c: 8.4, r: 9.8, k: 'pm' }, L5: { w: 7.1, c: 8, r: 9.8, k: 'pm' }, L6: { w: 11, c: 7.6, r: 9, k: 'mol' }, L7: { w: 10.4, c: 7.2, r: 8.6, k: 'mol' }
};
const geoOf = k => TOOTH_GEO[k[0] + k[2]];
const n2 = v => +v.toFixed(2);
function crownD(g) { // local coords: apex y=0, CEJ y=r, biting edge y=r+c
  const { w, c, r, k } = g, a = r, b = r + c, P = (x, y) => n2(x * w) + ' ' + n2(y);
  if (k === 'mol') return 'M' + P(.1, a) + 'C' + P(-.01, a + .2 * c) + ' ' + P(-.03, a + .6 * c) + ' ' + P(.03, b - 1.2) + 'Q' + P(.1, b + .1) + ' ' + P(.26, b) + 'Q' + P(.42, b) + ' ' + P(.5, b - .55) + 'Q' + P(.58, b) + ' ' + P(.74, b) + 'Q' + P(.9, b + .1) + ' ' + P(.97, b - 1.2) + 'C' + P(1.03, a + .6 * c) + ' ' + P(1.01, a + .2 * c) + ' ' + P(.9, a) + 'Z';
  if (k === 'can') return 'M' + P(.14, a) + 'C' + P(.01, a + .25 * c) + ' ' + P(-.04, a + .55 * c) + ' ' + P(.03, b - 2.8) + 'Q' + P(.22, b - 1.1) + ' ' + P(.5, b) + 'Q' + P(.78, b - 1.1) + ' ' + P(.97, b - 2.8) + 'C' + P(1.04, a + .55 * c) + ' ' + P(.99, a + .25 * c) + ' ' + P(.86, a) + 'Z';
  if (k === 'pm' || k === 'pm2') return 'M' + P(.14, a) + 'C' + P(0, a + .25 * c) + ' ' + P(-.05, a + .58 * c) + ' ' + P(.06, b - 2.2) + 'Q' + P(.27, b - .2) + ' ' + P(.5, b) + 'Q' + P(.73, b - .2) + ' ' + P(.94, b - 2.2) + 'C' + P(1.05, a + .58 * c) + ' ' + P(1, a + .25 * c) + ' ' + P(.86, a) + 'Z';
  return 'M' + P(.14, a) + 'C' + P(.02, a + .25 * c) + ' ' + P(-.03, a + .62 * c) + ' ' + P(.02, b - 1.5) + 'Q' + P(.05, b) + ' ' + P(.2, b) + 'H' + n2(.8 * w) + 'Q' + P(.95, b) + ' ' + P(.98, b - 1.5) + 'C' + P(1.03, a + .62 * c) + ' ' + P(.98, a + .25 * c) + ' ' + P(.86, a) + 'Z';
}
function rootD(g) {
  const { w, r, k } = g, P = (x, y) => n2(x * w) + ' ' + n2(y * r);
  if (k === 'mol') return 'M' + P(.1, 1) + 'C' + P(.05, .55) + ' ' + P(.12, .06) + ' ' + P(.25, .02) + 'C' + P(.35, 0) + ' ' + P(.4, .36) + ' ' + P(.43, .6) + 'Q' + P(.5, .74) + ' ' + P(.57, .6) + 'C' + P(.6, .36) + ' ' + P(.65, 0) + ' ' + P(.75, .02) + 'C' + P(.88, .06) + ' ' + P(.95, .55) + ' ' + P(.9, 1) + 'Z';
  if (k === 'pm2') return 'M' + P(.14, 1) + 'C' + P(.12, .5) + ' ' + P(.2, .08) + ' ' + P(.33, .03) + 'C' + P(.42, .06) + ' ' + P(.46, .25) + ' ' + P(.5, .36) + 'C' + P(.54, .25) + ' ' + P(.58, .06) + ' ' + P(.67, .03) + 'C' + P(.8, .08) + ' ' + P(.88, .5) + ' ' + P(.86, 1) + 'Z';
  return 'M' + P(.14, 1) + 'C' + P(.15, .45) + ' ' + P(.36, 0) + ' ' + P(.5, 0) + 'C' + P(.64, 0) + ' ' + P(.85, .45) + ' ' + P(.86, 1) + 'Z';
}
function implantSvg(g) { // a tapered screw where the root would be
  const { w, r } = g, top = r, bot = .1 * r, a = .25 * w, b = .75 * w, a2 = .35 * w, b2 = .65 * w;
  let s = '<path class="tcImp" d="M' + n2(a) + ' ' + n2(top) + 'L' + n2(b) + ' ' + n2(top) + 'L' + n2(b2) + ' ' + n2(bot + 1.2) + 'Q' + n2(.5 * w) + ' ' + n2(bot - .6) + ' ' + n2(a2) + ' ' + n2(bot + 1.2) + 'Z"/>';
  for (let i = 1; i <= 5; i++) { const y = top - i * (top - bot) / 6.3, f = (top - y) / (top - bot), l = a + (a2 - a) * f, rr = b - (b - b2) * f;
    s += '<path class="tcThr" d="M' + n2(l + .3) + ' ' + n2(y + .45) + 'L' + n2(rr - .3) + ' ' + n2(y - .45) + '"/>'; }
  return s;
}
function toothChartHTML(t, ro) {
  t = canonTeeth(t);
  const GAP = .7, MID = 1.4, PADX = 6, TOP = 1.5, BAND = 8.5;
  const width = arch => arch.reduce((s, k) => s + geoOf(k).w, 0) + GAP * 12 + MID;
  const W = Math.max(width(TEETH_U), width(TEETH_L)) + 2 * PADX;
  const HU = Math.max.apply(null, TEETH_U.map(k => geoOf(k).r + geoOf(k).c)), HL = Math.max.apply(null, TEETH_L.map(k => geoOf(k).r + geoOf(k).c));
  const occU = TOP + HU, occL = occU + BAND, H = occL + HL + TOP, out = [];
  [[TEETH_U, true], [TEETH_L, false]].forEach(([arch, up]) => {
    let x = (W - width(arch)) / 2;
    arch.forEach((k, i) => {
      const g = geoOf(k), m = t[k] || [], has = v => m.includes(v);
      const miss = has('missing'), imp = has('implant') && !miss, pon = has('pontic') && !miss && !imp, cr = has('crown') && !miss;
      const tf = 'translate(' + n2(x) + ' ' + n2(up ? occU - (g.r + g.c) : occL + g.r + g.c) + ')' + (up ? '' : ' scale(1 -1)');
      const cx = x + g.w / 2, crownY = up ? occU - g.c / 2 : occL + g.c / 2, rootY = up ? occU - g.c - g.r * .5 : occL + g.c + g.r * .5;
      const label = k + (m.length ? ': ' + MARKS.filter(z => m.includes(z.k)).map(z => z.l).join(', ') : '');
      let s = '<g class="tooth' + m.map(v => ' m-' + v).join('') + '" data-t="' + k + '"' + (ro ? '' : ' role="button" tabindex="0"') + ' aria-label="' + esc(label) + '"><title>' + esc(label) + '</title>'
        + '<rect class="hit" x="' + n2(x - GAP / 2) + '" y="' + n2(up ? TOP - .5 : occL) + '" width="' + n2(g.w + GAP) + '" height="' + n2((up ? HU : HL) + .5) + '" rx="1.6"/><g transform="' + tf + '">';
      if (miss) s += '<path class="tcGhost" d="' + rootD(g) + '"/><path class="tcGhost" d="' + crownD(g) + '"/>';
      else s += (imp ? implantSvg(g) : pon ? '' : '<path class="root" d="' + rootD(g) + '"/>') + '<path class="crown' + (imp ? ' imp' : cr ? ' cr' : '') + '" d="' + crownD(g) + '"/>';
      s += '</g>';
      if (has('noatt') && !miss) { const aw = Math.min(3.6, g.w * .46), ah = Math.min(2.4, g.c * .26), x0 = cx - aw / 2, y0 = crownY - ah / 2;
        s += '<g class="tcNa"><rect x="' + n2(x0) + '" y="' + n2(y0) + '" width="' + n2(aw) + '" height="' + n2(ah) + '" rx=".5"/><path d="M' + n2(x0 - .5) + ' ' + n2(y0 - .5) + 'L' + n2(x0 + aw + .5) + ' ' + n2(y0 + ah + .5) + 'M' + n2(x0 + aw + .5) + ' ' + n2(y0 - .5) + 'L' + n2(x0 - .5) + ' ' + n2(y0 + ah + .5) + '"/></g>'; }
      if (has('nomove') && !miss) s += '<g class="tcLock"><path d="M' + n2(cx - 1) + ' ' + n2(rootY - .2) + 'v-.9a1 1 0 0 1 2 0v.9"/><rect x="' + n2(cx - 1.55) + '" y="' + n2(rootY - .3) + '" width="3.1" height="2.5" rx=".5"/></g>';
      out.push(s + '<text class="tcNum" x="' + n2(cx) + '" y="' + n2(up ? occU + 3.3 : occL - 1.6) + '">' + k[2] + '</text></g>');
      x += g.w + GAP + (i === 6 ? MID : 0);
    });
  });
  const mid = n2(W / 2), band = n2(occU + BAND / 2);
  return '<svg class="tcSvg" viewBox="0 0 ' + n2(W) + ' ' + n2(H) + '" role="group" aria-label="Tooth chart (R is the patient’s right)">'
    + '<path class="tcMidl" d="M' + mid + ' .5V' + n2(H - .5) + '"/><path class="tcOcc" d="M' + n2(PADX - 2) + ' ' + band + 'H' + n2(W - PADX + 2) + '"/>'
    + '<text class="tcSide" x="1.2" y="' + n2(+band + 1) + '">R</text><text class="tcSide" x="' + n2(W - 1.2) + '" y="' + n2(+band + 1) + '" text-anchor="end">L</text>'
    + out.join('') + '</svg>';
}
/* small glyphs on the marker buttons */
const MARK_GLYPH = {
  noatt: '<rect x="3" y="5" width="10" height="6" rx="1.4" fill="#64F4C9"/><path d="M2.5 3.5l11 9M13.5 3.5l-11 9" stroke="#D8412E" stroke-width="1.6" stroke-linecap="round"/>',
  implant: '<path d="M3.5 7.5c0-2.5 1.6-4 4.5-4s4.5 1.5 4.5 4z" fill="#C3C9D0" stroke="#4C5868" stroke-width="1"/><path d="M5.5 8.2h5l-1 6.3H6.5z" fill="#969FAB" stroke="#4C5868" stroke-width=".9" stroke-linejoin="round"/><path d="M5.8 10.2h4.4M6.1 12.2h3.8" stroke="#4C5868" stroke-width=".8"/>',
  crown: '<path d="M3.5 4.5s1.8-1 4.5-1 4.5 1 4.5 1c.5 3 .3 6-.6 8.4-.4 1-1.2 1.6-2.2 1.6H6.3c-1 0-1.8-.6-2.2-1.6-.9-2.4-1.1-5.4-.6-8.4z" fill="#FCE2A6" stroke="#C2820A" stroke-width="1.1"/>',
  pontic: '<path d="M3.5 4.5s1.8-1 4.5-1 4.5 1 4.5 1c.5 3 .3 6-.6 8.4-.4 1-1.2 1.6-2.2 1.6H6.3c-1 0-1.8-.6-2.2-1.6-.9-2.4-1.1-5.4-.6-8.4z" fill="#fff" stroke="#1B2F4C" stroke-width="1.1"/><path d="M2 2h12" stroke="#FFC8BF" stroke-width="2" stroke-linecap="round"/>',
  missing: '<path d="M3.5 4.5s1.8-1 4.5-1 4.5 1 4.5 1c.5 3 .3 6-.6 8.4-.4 1-1.2 1.6-2.2 1.6H6.3c-1 0-1.8-.6-2.2-1.6-.9-2.4-1.1-5.4-.6-8.4z" fill="none" stroke="#969FAB" stroke-width="1.1" stroke-dasharray="1.6 1.3"/>',
  nomove: '<path d="M5.3 7.5V5.6a2.7 2.7 0 0 1 5.4 0v1.9" fill="none" stroke="#1B2F4C" stroke-width="1.5"/><rect x="3.8" y="7.2" width="8.4" height="6.8" rx="1.5" fill="#1B2F4C"/>'
};
function markGlyph(k) { return '<svg class="mkg" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + (MARK_GLYPH[k] || '') + '</svg>'; }
/* "No IPR / No attachments / No elastics": the thing itself with a coral "no" badge */
const NO_BADGE = '<circle cx="38.5" cy="37.5" r="8.6" fill="#FA624D"/><path d="M35.1 34.1l6.8 6.8M41.9 34.1l-6.8 6.8" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>';
const RX_ICONS = {
  noipr: '<rect x="2.5" y="8" width="38" height="23" rx="7" fill="none" stroke="currentColor" stroke-width="2.4"/><text x="21.5" y="24.6" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor" font-family="Montserrat,system-ui,sans-serif" letter-spacing=".4">IPR</text>' + NO_BADGE,
  noatt: '<path class="tk" d="M9.8 8C8.7 14 8.3 24 8.7 31.4Q9.1 36 12.6 36H26.4Q29.9 36 30.3 31.4C30.7 24 30.3 14 29.2 8Z"/><rect class="tg" x="6.5" y="3" width="26" height="7.2" rx="3.6"/><rect class="tf" x="13.8" y="17" width="11.4" height="7.4" rx="1.8"/>' + NO_BADGE,
  noelastic: '<ellipse class="ta" cx="21" cy="21" rx="17" ry="4.6" transform="rotate(45 21 21)" style="stroke-width:2.8"/><circle cx="9" cy="9" r="3.8" fill="currentColor"/><circle cx="33" cy="33" r="3.8" fill="currentColor"/>' + NO_BADGE
};
function rxSvg(k) { return '<svg class="isvg rxsvg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + (RX_ICONS[k] || '') + '</svg>'; }
function safeUrl(u) { return /^https:\/\/[^\s<>"']+$/i.test(String(u || '').trim()) ? String(u).trim() : ''; }
function sameVal(a, b) { return JSON.stringify(a == null ? '' : a) === JSON.stringify(b == null ? '' : b); }
/* office holidays from the handbook (same list as the NLO Calendar) */
function officeHolidays(y) {
  const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + (n - 1) * 7); return d; };
  const last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return d; };
  const thx = nth(10, 4, 4), near = k => { const d = new Date(thx); d.setDate(thx.getDate() + k); return d; };
  return [new Date(y, 0, 1), last(4, 1), new Date(y, 6, 4), nth(8, 1, 1), near(-1), thx, near(1), new Date(y, 11, 25)].map(isoOf);
}
/* the next n clinic days (the office sees patients Monday–Thursday; handbook holidays are skipped) */
function addClinicDays(iso, n) {
  let d = iso; let left = n;
  while (left > 0) {
    d = addDays(d, 1); const [y, m, dd] = d.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay();
    if (wd >= 1 && wd <= 4 && !officeHolidays(y).includes(d)) left--;
  }
  return d;
}
function defaultAssignee(type) {
  const d = (S.settings.defaults || {})[type]; if (d && staff(d) && staff(d).active) return d;
  const byFirst = n => (activeRoster().find(r => firstName(r.name).toLowerCase() === n) || {}).sid || '';
  const owner = (activeRoster().find(r => r.role === 'owner') || {}).sid || '';
  if (['oliv', 'angel', 'invisalign', 'appliance', 'marpe'].includes(type)) return byFirst('sarah') || '';
  if (['ulab', 'insmile', 'inbrace', 'retainer', 'mouthguard', 'models'].includes(type)) return meSid();
  return owner;
}
/* the patient's CC phrases this office uses most (learned from decrypted cases, in this browser only) */
function learnedCCs() {
  const n = {};
  Array.from(S.cases.values()).concat(S.closed || []).forEach(c => {
    const t = String(c.cc || '').trim(); if (t.length < 3 || t.length > 90 || /^(-|na|n\/a|none)$/i.test(t)) return;
    const k = t.toLowerCase(); n[k] = n[k] || { t, c: 0 }; n[k].c++;
  });
  return Object.values(n).filter(x => x.c >= 2).sort((a, b) => b.c - a.c).slice(0, 6).map(x => x.t);
}
/* the current buttons plus any retired choice already saved on this case, so editing an older case never drops it */
function withSaved(list, saved) { saved = [].concat(saved || []).filter(Boolean); return list.concat(saved.filter(v => !list.includes(v))); }
function pickRow(group, options, chosen, multi, extraCls) {
  const on = v => multi ? (chosen || []).includes(v) : chosen === v;
  return '<div class="pickRow" role="group" data-g="' + group + '" data-multi="' + (multi ? 1 : 0) + '">' + options.map(o => {
    const v = typeof o === 'string' ? o : o.v; const l = typeof o === 'string' ? o : o.l;
    return '<button type="button" class="pick' + (extraCls ? ' ' + extraCls : '') + '" data-v="' + esc(v) + '" aria-pressed="' + on(v) + '">' + esc(l) + '</button>';
  }).join('') + '</div>';
}
function caseFormHTML(c, isNew) {
  c = c || {};
  const tile = c.type || '';
  const g = groupOfTile(tile);
  const show = (groups) => ' data-show="' + groups + '"' + (groups.split(' ').includes(g) ? '' : ' style="display:none"');
  const showTiles = (tiles) => ' data-tiles="' + tiles + '"' + (tiles.split(' ').includes(tile) ? '' : ' style="display:none"');
  const roster = activeRoster().filter(r => r.role !== 'owner');
  const stages = c.type ? FLOWS[TYPE[c.type].flow].stages : [];
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  const people = (sel, none) => opt('', none) + activeRoster().map(r => opt(r.sid, r.name, sel === r.sid)).join('');
  const date = (id, l, v) => '<div class="field"><label for="' + id + '">' + l + '</label><input type="date" id="' + id + '" value="' + esc(v || '') + '"></div>';
  const instrOther = c.instrOther != null ? c.instrOther : (((c.instrPicks || []).length || Object.keys(c.goals || {}).length) ? '' : (c.instructions || ''));
  const picks = c.instrPicks || [], oldPicks = picks.filter(v => !INSTR.some(it => it.v === v));
  // Mid-course correction used to be an "Also" choice; it is now a kind of submission
  const extras = (c.extras || []).filter(x => x !== 'Mid-course correction'), oldExtras = extras.filter(x => !PICK.extras.includes(x));
  const initialVal = c.type === 'nla' && c.variant === 'finishing' ? FIN : !c.initial && (c.extras || []).includes('Mid-course correction') ? 'mid' : (c.initial || '');
  const teeth0 = canonTeeth(c.teeth), scope0 = noattScopeOf(teeth0);
  const rxTile = (v, ic, l) => '<button type="button" class="pick rxTile" data-v="' + esc(v) + '" aria-pressed="' + extras.includes(v) + '">' + rxSvg(ic) + '<span><b>' + esc(l) + '</b></span></button>';
  const ccs = learnedCCs();
  return '<div class="cf" data-new="' + (isNew ? 1 : 0) + '" data-id="' + esc(c.id || '') + '">' +
    '<div class="cfSec"><h5>Case type</h5><div class="tileGrid" role="radiogroup" aria-label="Case type">' + TILES.filter(t => !t.legacy || t.v === tile).map(t =>
      '<button type="button" class="tt' + (t.c ? ' c-' + t.c : '') + '" role="radio" data-tile="' + t.v + '" aria-checked="' + (tile === t.v) + '">' + tileArt(t) + '<b>' + esc(t.l) + '</b><span>' + esc(t.s) + '</span></button>').join('') + '</div></div>' +
    // a new case can take the patient's photo right here (a case being edited changes it from the case itself)
    '<div class="cfSec"><div class="ptRowF">' + (isNew ? phSlotHTML() : '') + '<div class="grid2"><div class="field"><label for="cf-patient">Patient name *</label><input id="cf-patient" autocomplete="off" value="' + esc(c.patient || '') + '" required></div>' +
    '<div class="field"><label for="cf-chart">Chart #</label><input id="cf-chart" autocomplete="off" spellcheck="false" inputmode="text" placeholder="For the IPR Tracker link" value="' + esc(c.chart || '') + '"></div></div></div></div>' +
    '<div class="cfSec"' + show('appliance marpe') + '><div' + show('appliance') + '><h5>Appliance</h5>' + pickRow('appliances', withSaved(PICK.appliances, c.appliances), c.appliances || [], true) + '</div>' +
    '<h5>Lab</h5>' + pickRow('lab', withSaved(PICK.labs, c.lab), c.lab || '', false) + '<div class="hint small" id="cf-labHint" style="margin-top:6px"></div></div>' +
    // MARPE: the two records the lab needs, and the Zoom call once it's set up
    '<div class="cfSec"' + show('marpe') + '><h5>Records on file <span class="h5n">both have to be on file before it goes to the lab</span></h5>' +
      pickRow('records', MARPE_RECORDS.map(([v, l]) => ({ v, l })), c.records || [], true) +
      '<h5>Zoom call <span class="h5n">once the lab sets it up</span></h5><div class="zoomRow">' + date('cf-zoomDate', 'Date', c.zoomDate) +
      '<div class="field"><label for="cf-zoomTime">Time</label><input type="time" id="cf-zoomTime" value="' + esc(c.zoomTime || '') + '"></div></div></div>' +
    '<div class="cfSec"' + show('retainer') + '><h5>Arch</h5>' + pickRow('arches', PICK.arches, c.arches || [], true) + '<div id="cf-retKindsWrap"' + (tile === 'mouthguard' ? ' style="display:none"' : '') + '><h5>Making</h5>' + pickRow('retKinds', PICK.retKinds, c.retKinds || [], true) + '</div></div>' +
    // aligners and InSmile: which arches are treated — both unless picked (Amir, 2 Oct 2026: not always both arches)
    '<div class="cfSec"' + show('aligner braces') + '><h5>Arches to treat</h5>' + pickRow('treatArch', TREAT_OPTS, oneArch(c) || 'UL', false) + '</div>' +
    '<div class="cfSec"' + show('aligner') + '><h5>Initial submission?</h5>' + pickRow('initial', [{ v: 'yes', l: 'Yes — first set' }, { v: 'no', l: 'No — refinement' }, { v: 'mid', l: 'Mid-course correction' }, { v: FIN, l: 'Finishing aligners' }], initialVal, false) + '</div>' +
    // in-house: one count per treated arch (the untreated arch's field is hidden, see wireCaseForm)
    '<div class="cfSec"' + showTiles(INHOUSE_TILES.join(' ')) + '><h5>Aligners in this set <span class="h5n">count each arch from Titan</span></h5><div class="alRow">' +
      '<div class="field"' + (oneArch(c) === 'L' ? ' style="display:none"' : '') + '><label for="cf-alU">Upper aligners</label><input id="cf-alU" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alU || '') + '"></div>' +
      '<div class="field"' + (oneArch(c) === 'U' ? ' style="display:none"' : '') + '><label for="cf-alL">Lower aligners</label><input id="cf-alL" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alL || '') + '"></div>' +
      '<div class="alTot" id="cf-alTotal" aria-live="polite"></div></div>' +
      '<h5>Attachment templates <span class="h5n">asked again when it moves to Export STLs</span></h5>' + pickRow('atTemplates', AT_OPTS, atFor(c.atTemplates, oneArch(c)), false) + '</div>' +
    '<div class="cfSec"' + showTiles('insmile') + '><h5>Initial or digital enhancement?</h5>' + pickRow('initialDE', [{ v: 'yes', l: 'Initial' }, { v: 'de1', l: 'DE 1' }, { v: 'de2', l: 'DE 2' }, { v: 'de3', l: 'DE 3' }], c.initial || '', false) + '</div>' +
    '<div class="cfSec"><h5>Assistant</h5>' + staffPickRow('assistant', withSavedStaff(roster, c.assistant), c.assistant || '') +
    '<div' + show('aligner braces appliance marpe retainer models') + '><h5>Scanner</h5>' + pickRow('scanner', PICK.scanners, c.scanner || '', false) + '</div></div>' +
    '<div class="cfSec"><h5>Dates</h5><div class="pickRow" style="margin-bottom:8px"><button type="button" class="pick sm" data-scan="0">Scanned today</button><button type="button" class="pick sm" data-scan="-1">Yesterday</button></div>' +
    '<div class="grid3">' + date('cf-scanDate', 'Scan date', c.scanDate) + date('cf-labDate', 'Lab completion', c.labDate) + '<div class="field"><label for="cf-deliveryDate">Delivery</label><input type="date" id="cf-deliveryDate" value="' + esc(c.deliveryDate || '') + '">' + timeSelectHTML('cf-deliveryTime', c.deliveryTime || '', 'Delivery time') + '</div>' + '</div>' +
    '<div class="hint small muted" id="cf-autoHint" style="margin:-4px 0 0">Filled in from the scan date — change any of them.</div>' +
    // aligners going straight to the patient: an alert on the case everywhere it shows (Amir, 2 Oct 2026)
    '<div' + show('aligner') + '><button type="button" class="shipTgl" id="cf-ship" aria-pressed="' + !!c.shipToPatient + '">' + ic('truck', 22) +
      '<span><b>Ship to patient</b><small>Shows as an alert on the case</small></span></button></div></div>' +
    '<div class="cfSec"' + show('aligner braces') + '><h5>Dr. A’s instructions from last visit</h5>' +
    '<div class="goalGrid">' + GOALS.map(gl => '<div class="goal">' + instrSvg(gl.ic) + '<div class="goalB"><b>' + esc(gl.l) + '</b>' + (gl.s ? '<span>' + esc(gl.s) + '</span>' : '') + '</div>' +
      pickRow('goal_' + gl.k, [{ v: 'maintain', l: 'Maintain' }, { v: 'improve', l: 'Improve' }], (c.goals || {})[gl.k] || '', false, 'sm') + '</div>').join('') + '</div>' +
    '<div class="pickRow itGrid" role="group" aria-label="Instructions" data-g="instrPicks" data-multi="1">' + INSTR.map(it =>
      '<button type="button" class="pick itile" data-v="' + esc(it.v) + '" aria-pressed="' + picks.includes(it.v) + '" title="' + esc(it.v) + '">' + instrSvg(it.ic) + '<span>' + esc(it.l) + '</span></button>').join('') + '</div>' +
    (oldPicks.length ? '<div class="hint small muted" style="margin:10px 0 6px">Earlier choices on this case</div>' + pickRow('instrPicks', oldPicks, oldPicks, true) : '') +
    '<div class="field" style="margin-top:10px"><label for="cf-instrOther">Other instructions</label><textarea id="cf-instrOther" rows="2" placeholder="Only if it isn’t one of the pictures">' + esc(instrOther) + '</textarea></div></div>' +
    '<div class="cfSec"' + show('aligner') + '><h5>Teeth, IPR &amp; attachments</h5>' +
    '<div class="pickRow rxGrid" data-g="extras" data-multi="1">' + rxTile('No IPR', 'noipr', 'No IPR') +
      '<button type="button" class="rxTile" id="cf-noatt" aria-pressed="' + !!scope0 + '" aria-controls="cf-noattScope">' + rxSvg('noatt') + '<span><b>No attachments</b><small id="cf-noattSub">' + esc(scope0 ? NOATT_SCOPES.find(x => x.v === scope0).l : '') + '</small></span></button>' +
      rxTile('No elastics', 'noelastic', 'No elastics') + '</div>' +
    '<div class="noattScope" id="cf-noattScope"' + (scope0 ? '' : ' hidden') + '><span class="lbl">No attachments on</span>' + NOATT_SCOPES.map(sc =>
      '<button type="button" class="pick sm" data-scope="' + sc.v + '" aria-pressed="' + (scope0 === sc.v) + '">' + esc(sc.l) + '</button>').join('') + '</div>' +
    (oldExtras.length ? '<div class="hint small muted" style="margin:10px 0 6px">Earlier choices on this case</div>' + pickRow('extras', oldExtras, oldExtras, true) : '') +
    '<div class="tc" id="cf-tc"><div class="pickRow tcTools" role="radiogroup" aria-label="Marker">' +
    MARKS.map((m, i) => '<button type="button" class="pick sm tool m-' + m.k + '" data-tool="' + m.k + '" role="radio" aria-checked="' + (i === 0) + '">' + markGlyph(m.k) + esc(m.l) + '</button>').join('') + '</div>' +
    '<div class="pickRow tcQuick"><span class="lbl">Mark a whole group</span><button type="button" class="pick sm" data-tq="uant">Upper 3–3</button><button type="button" class="pick sm" data-tq="ant">Anteriors 3–3</button><button type="button" class="pick sm" data-tq="post">Posteriors 4–7</button><button type="button" class="pick sm" data-tq="all">All teeth</button><span class="tcSep"></span><button type="button" class="pick sm" data-tq="clear">Clear chart</button></div>' +
    '<div id="cf-tcChart">' + toothChartHTML(teeth0, false) + '</div><div class="tcSum" id="cf-teethSum">' + esc(teethSummary(teeth0) || 'Pick a marker, then tap teeth.') + '</div>' +
    '<input type="hidden" id="cf-teeth" value="' + esc(JSON.stringify(teeth0)) + '"></div></div>' +
    '<div class="cfSec"' + show('aligner braces appliance marpe') + '><h5>Patient’s CC from last visit</h5>' +
    '<div class="pickRow" data-cc="1">' + ['None'].concat(ccs).map(t => '<button type="button" class="pick sm" data-cc="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
    '<div class="field" style="margin-top:8px"><label for="cf-cc" class="hidden">Patient’s CC</label><input id="cf-cc" autocomplete="off" placeholder="Tap above or type" value="' + esc(c.cc || '') + '"></div></div>' +
    '<div class="cfSec"' + show('aligner') + '><div class="field"><label for="cf-ipr" style="display:flex;align-items:center;gap:8px">IPR, spacing &amp; black triangles<span style="flex:1"></span><button type="button" class="btn btn-ghost" data-act="iprPull" style="min-height:30px;padding:2px 10px;font-size:12px">' + ic('download', 14) + 'Get from IPR Tracker</button></label>' +
    '<textarea id="cf-ipr" rows="3" placeholder="Tap “Get from IPR Tracker” (uses the chart #)">' + esc(c.ipr || '') + '</textarea><div class="hint" id="cf-iprMsg"></div></div></div>' +
    '<div class="cfSec" id="cf-titanWrap"' + show(INHOUSE_TILES.includes(tile) ? g : '__never') + '><div class="field"><label for="cf-titanUrl">Titan link</label><input id="cf-titanUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… (Titan’s shared web-viewer link)" value="' + esc(c.titanUrl || '') + '"></div></div>' +
    '<details class="cfMore"' + (isNew ? '' : ' open') + '><summary>More: what’s being made, stage, who it’s assigned to, notes</summary>' +
    '<div class="grid2" style="margin-top:12px"><div class="field"><label for="cf-detail">What’s being made</label><input id="cf-detail" value="' + esc(c.detail || '') + '" data-auto="' + (isNew || !c.detail ? 1 : 0) + '"></div>' +
    '<div class="field"><label for="cf-stage">Stage</label><select id="cf-stage">' + stages.map(([k, l]) => opt(k, l, (c.stage || (stages[0] || [])[0]) === k)).join('') + '</select></div></div>' +
    '<div class="field"><label>Assigned to</label>' + assignTilesHTML('cf-assignee', c.assignee) + '</div>' +
    '<div class="grid2"><div class="field"><label for="cf-tracking">Tracking #</label><input id="cf-tracking" autocomplete="off" spellcheck="false" placeholder="UPS, FedEx or USPS — becomes a Track button" value="' + esc(c.tracking || '') + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="cf-labRef">Lab case # / patient ID</label><input id="cf-labRef" autocomplete="off" spellcheck="false" placeholder="The lab’s own number (lab emails fill it in)" value="' + esc(c.labRef || '') + '"></div><div></div></div>' +
    '<div class="field"><label for="cf-notes">Notes</label><textarea id="cf-notes" rows="2">' + esc(c.notes || '') + '</textarea></div></details>' +
    '<input type="hidden" id="cf-tile" value="' + esc(tile) + '"></div>';
}
/* staff as photo tiles with the name underneath (Amir: "their photos with their names underneath instead of just a text box").
   Photos come from Staff Hub (Team & security → From Staff Hub); without one, the initials show. */
function staffLabel(r) { return r ? (r.role === 'owner' ? 'Dr. A' : firstName(r.name)) : 'Nobody'; }
function staffTile(r, on, cls, extra) {
  return '<button type="button" class="' + cls + ' sTile" data-v="' + esc(r ? r.sid : '') + '" aria-pressed="' + !!on + '"' + (extra || '') + ' title="' + esc(r ? r.name : 'Not assigned to anyone') + '">' +
    '<span class="av sAv' + (r ? '' : ' none') + '"' + (r ? ' data-sav="' + esc(r.sid) + '"' : '') + '>' + (r ? esc(r.initials || initials(r.name)) : '–') + '</span><span class="sNm">' + esc(staffLabel(r)) + '</span></button>';
}
/* the assistant: a pick row (one at a time) of staff tiles */
function staffPickRow(group, people, chosen) {
  return '<div class="pickRow staffRow" role="group" data-g="' + group + '" data-multi="0">' + people.map(r => staffTile(r, chosen === r.sid, 'pick')).join('') + '</div>';
}
/* "assigned to" in the form: tiles (with Nobody) over a hidden field the rest of the form reads and sets */
function assignTilesHTML(id, chosen) {
  return '<input type="hidden" id="' + id + '" value="' + esc(chosen || '') + '"><div class="staffRow aTiles" data-for="' + id + '" role="radiogroup" aria-label="Assigned to">' +
    [null].concat(activeRoster()).map(r => staffTile(r, (chosen || '') === (r ? r.sid : ''), 'aTile', ' role="radio"')).join('') + '</div>';
}
function assignTilesSync(root) {
  $$('.aTiles[data-for]', root).forEach(row => { const inp = $('#' + row.dataset.for, root); if (!inp) return; $$('.aTile', row).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === inp.value))); });
}
function pressed(root, g) { return $$('.pickRow[data-g="' + g + '"] .pick[aria-pressed="true"]', root).map(b => b.dataset.v); }
function readCaseForm(root) {
  const tile = $('#cf-tile', root).value;
  const o = { type: INHOUSE_TILES.includes(tile) ? 'nla' : tile, variant: '' };
  ['patient', 'chart', 'detail', 'stage', 'assignee', 'scanDate', 'labDate', 'deliveryDate', 'deliveryTime', 'instrOther', 'cc', 'ipr', 'notes', 'titanUrl', 'zoomDate', 'zoomTime', 'tracking', 'labRef'].forEach(k => { const el = $('#cf-' + k, root); o[k] = el ? String(el.value || '').trim() : ''; });
  o.assistant = pressed(root, 'assistant')[0] || '';
  o.scanner = pressed(root, 'scanner')[0] || '';
  const g0 = groupOfTile(tile);
  const ini = pressed(root, 'initial')[0] || '';
  if (o.type === 'nla' && ini === FIN) o.variant = 'finishing'; // in-house finishing aligners (not a kind of submission on the case)
  o.initial = tile === 'insmile' ? (pressed(root, 'initialDE')[0] || '') : g0 === 'aligner' && ini !== FIN ? ini : '';
  o.lab = pressed(root, 'lab')[0] || '';
  o.appliances = pressed(root, 'appliances'); o.arches = pressed(root, 'arches'); o.retKinds = pressed(root, 'retKinds');
  o.instrPicks = pressed(root, 'instrPicks'); o.extras = pressed(root, 'extras');
  o.goals = {}; GOALS.forEach(gl => { const v = pressed(root, 'goal_' + gl.k)[0]; if (v) o.goals[gl.k] = v; });
  try { o.teeth = canonTeeth(JSON.parse($('#cf-teeth', root).value || '{}')); } catch (e) { o.teeth = {}; }
  o.teethNote = teethSummary(o.teeth);
  const g = groupOfTile(tile);
  if (g === 'braces') o.instrPicks = o.instrPicks.filter(x => !ALIGNER_ONLY_INSTR.includes(x));
  if (g !== 'aligner' && g !== 'braces') { o.instrPicks = []; o.goals = {}; }
  if (g !== 'aligner') { o.extras = []; o.teeth = {}; o.teethNote = ''; }
  if (g !== 'appliance' && g !== 'marpe') { o.appliances = []; o.lab = ''; }
  if (g === 'marpe') o.appliances = [];
  // MARPE: records on file and the Zoom call; aligners: ship to patient (empty is '', see FORM_KEYS)
  const recs = pressed(root, 'records'); o.records = g === 'marpe' && recs.length ? recs : '';
  if (g !== 'marpe') { o.zoomDate = ''; o.zoomTime = ''; } else if (!o.zoomDate) o.zoomTime = '';
  if (!o.deliveryDate) o.deliveryTime = ''; // a time only goes with a delivery date
  const ship = $('#cf-ship', root); o.shipToPatient = g === 'aligner' && ship && ship.getAttribute('aria-pressed') === 'true' ? true : '';
  if (g !== 'retainer') { o.arches = []; o.retKinds = []; }
  if (tile === 'mouthguard') o.retKinds = [];
  if (!(o.type === 'nla')) o.titanUrl = '';
  // arches to treat: aligners and InSmile only; both arches is the default and saves as '' (like every older case)
  const ta = pressed(root, 'treatArch')[0] || '';
  o.treatArch = (g === 'aligner' || g === 'braces') && (ta === 'U' || ta === 'L') ? ta : '';
  // in-house: aligners per treated arch; the set's total is upper + lower (aligners, not stages)
  const num = id => { const v = parseInt(($(id, root) || {}).value, 10); return o.type === 'nla' && v > 0 ? Math.min(v, 99) : ''; };
  o.atTemplates = o.type === 'nla' ? atFor(pressed(root, 'atTemplates')[0] || '', o.treatArch) : '';
  o.alU = o.treatArch === 'L' ? '' : num('#cf-alU'); o.alL = o.treatArch === 'U' ? '' : num('#cf-alL'); o.aligners = (o.alU || 0) + (o.alL || 0) || '';
  o.instructions = goalText(o.goals).concat(o.instrPicks, o.instrOther ? [o.instrOther] : []).join('; ');
  return o;
}
/* what's being made, from the taps */
function autoDetail(o, tile) {
  const t = TILES.find(x => x.v === tile);
  const sub = o.initial === 'no' ? ' – refinement' : o.initial === 'mid' ? ' – mid-course correction' : '';
  const only = o.treatArch === 'U' ? 'upper only' : o.treatArch === 'L' ? 'lower only' : ''; // "Aligners (Oliv, upper only)"
  if (tile === 'nla' && o.variant === 'finishing') return 'Finishing aligners' + (only ? ' (' + only + ')' : '');
  if (['oliv', 'angel', 'invisalign', 'ulab', 'nla'].includes(tile)) return 'Aligners (' + (tile === 'nla' ? 'In-House' : t.l) + (only ? ', ' + only : '') + ')' + sub;
  if (tile === 'inbrace') return 'InBrace/Brava' + (only ? ' (' + only + ')' : '');
  if (tile === 'insmile') return 'InSmile braces' + (only ? ' (' + only + ')' : '') + (/^de[123]$/.test(o.initial) ? ' – DE' + o.initial.slice(2) : '');
  if (tile === 'appliance') return o.appliances.join(', ');
  if (tile === 'models') return 'Study models';
  if (tile === 'marpe') return 'MARPE';
  if (tile === 'retainer' || tile === 'mouthguard') {
    const arch = o.arches.length === 2 ? 'U/L' : o.arches[0] === 'Upper' ? 'U' : o.arches[0] === 'Lower' ? 'L' : '';
    if (tile === 'mouthguard') return 'Mouthguard' + (arch ? ' (' + arch + ')' : '');
    const kinds = o.retKinds.join(' and ');
    return [arch, kinds].filter(Boolean).join(' ');
  }
  return '';
}
function wireCaseForm(root, isNew) {
  const $r = s => $(s, root);
  $$('img[data-logo]', root).forEach(i => { const lg = LOGOS[i.dataset.logo]; if (lg) i.src = lg.src; });
  $$('img[data-pic]', root).forEach(i => { const pc = PICS[i.dataset.pic]; if (pc) i.src = pc.src; });
  const autoIds = ['cf-labDate', 'cf-deliveryDate'];
  autoIds.forEach(id => { const el = $r('#' + id); el.dataset.auto = (isNew && !el.value) ? '1' : '0'; el.addEventListener('input', () => { el.dataset.auto = '0'; }); });
  const det = $r('#cf-detail'); det.addEventListener('input', () => { det.dataset.auto = '0'; });
  // editing: a "what's being made" line nobody typed (it matches the taps) keeps following the taps, e.g. Upper only
  if (!isNew && det.dataset.auto !== '1' && det.value && det.value === autoDetail(readCaseForm(root), $r('#cf-tile').value)) det.dataset.auto = '1';
  const refresh = (typeChanged) => {
    const tile = $r('#cf-tile').value; const g = groupOfTile(tile); const o = readCaseForm(root);
    $$('[data-show]', root).forEach(el => { el.style.display = el.dataset.show.split(' ').includes(g) ? '' : 'none'; });
    $$('[data-tiles]', root).forEach(el => { el.style.display = el.dataset.tiles.split(' ').includes(tile) ? '' : 'none'; });
    $$('.pickRow[data-g="instrPicks"] .pick', root).forEach(b => { if (ALIGNER_ONLY_INSTR.includes(b.dataset.v)) b.style.display = g === 'braces' ? 'none' : ''; });
    const tw = $r('#cf-titanWrap'); if (tw) tw.style.display = INHOUSE_TILES.includes(tile) ? '' : 'none';
    $$('.pickRow[data-g="initial"] .pick[data-v="' + FIN + '"]', root).forEach(btn => { const on = INHOUSE_TILES.includes(tile); btn.style.display = on ? '' : 'none'; if (!on) btn.setAttribute('aria-pressed', 'false'); });
    const rk = $r('#cf-retKindsWrap'); if (rk) rk.style.display = tile === 'mouthguard' ? 'none' : '';
    // one arch only: just that arch's aligner count, and only the attachment-template answers that fit it
    const ta = o.treatArch, fU = $r('#cf-alU'), fL = $r('#cf-alL');
    if (fU) fU.closest('.field').style.display = ta === 'L' ? 'none' : '';
    if (fL) fL.closest('.field').style.display = ta === 'U' ? 'none' : '';
    const atRow = $r('.pickRow[data-g="atTemplates"]');
    if (atRow) {
      const fit = atOptsFor(ta).map(x => x.v), was = pressed(root, 'atTemplates')[0] || '', now = atFor(was, ta);
      $$('.pick', atRow).forEach(b => { b.style.display = fit.includes(b.dataset.v) ? '' : 'none'; if (now !== was) b.setAttribute('aria-pressed', String(b.dataset.v === now)); });
    }
    if (typeChanged) {
      const type = o.type, stage = $r('#cf-stage');
      stage.innerHTML = type ? FLOWS[TYPE[type].flow].stages.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') : '';
      if (isNew && type) { stage.dataset.manual = ''; $r('#cf-assignee').dataset.manual = ''; $r('#cf-assignee').value = defaultAssignee(type); }
      if (isNew && ['aligner', 'braces', 'appliance', 'marpe', 'retainer', 'models'].includes(g) && !pressed(root, 'scanner').length) setPick(root, 'scanner', 'Allied Star', true);
      if (g === 'appliance' || g === 'marpe') routeLab(root, isNew);
    }
    // dates from the scan date (only fields nobody has typed into)
    const scan = $r('#cf-scanDate').value;
    if (isNew && scan) {
      // retainers (and mouthguards): delivered 2 office days after the scan (SOP: standard turnaround 2 business days)
      const plan = (tile === 'retainer' || tile === 'mouthguard') ? { 'cf-labDate': '', 'cf-deliveryDate': addClinicDays(scan, 2) }
        : (g === 'aligner' || g === 'braces') ? { 'cf-labDate': addDays(scan, 21), 'cf-deliveryDate': addDays(scan, 28) }
          : { 'cf-labDate': '', 'cf-deliveryDate': '' };
      autoIds.forEach(id => { const el = $r('#' + id); if (el.dataset.auto === '1') el.value = plan[id]; });
    }
    if (det.dataset.auto === '1') det.value = autoDetail(o, tile);
    assignTilesSync(root); alTot();
  };
  // in-house aligners: this set plus the patient's earlier sets (matched by chart #, else name)
  const cfEl = $('.cf', root) || root;
  const alTot = () => {
    const box = $r('#cf-alTotal'); if (!box) return;
    const tile = $r('#cf-tile').value; if (!INHOUSE_TILES.includes(tile)) { box.innerHTML = ''; return; }
    const o = readCaseForm(root); o.id = cfEl.dataset.id || ''; if (!o.id) o._new = true;
    box.innerHTML = alignerTotalHTML(o, true); ensureHist();
  };
  cfEl._alTot = alTot;
  ['cf-patient', 'cf-chart', 'cf-alU', 'cf-alL'].forEach(id => { const el = $r('#' + id); if (el) el.addEventListener('input', alTot); });
  root.addEventListener('click', e => {
    const tt = e.target.closest('.tt[data-tile]');
    if (tt && root.contains(tt)) { $$('.tt[data-tile]', root).forEach(b => b.setAttribute('aria-checked', String(b === tt))); $r('#cf-tile').value = tt.dataset.tile; refresh(true); return; }
    const pk = e.target.closest('.pickRow[data-g] .pick');
    if (pk && root.contains(pk)) {
      const row = pk.closest('.pickRow'); const multi = row.dataset.multi === '1'; const was = pk.getAttribute('aria-pressed') === 'true';
      // MARPE runs on its own steps: tapping it under Appliance switches the case to the MARPE tile
      if (row.dataset.g === 'appliances' && pk.dataset.v === 'MARPE' && !was && $r('#cf-tile').value === 'appliance') {
        const mt = $r('.tt[data-tile=marpe]'); if (mt) { mt.click(); toast('MARPE has its own steps, so this is now a MARPE case'); return; }
      }
      if (multi) pk.setAttribute('aria-pressed', String(!was));
      // (arches to treat always has an answer: tapping the chosen one again keeps it)
      else { $$('.pick', row).forEach(b => b.setAttribute('aria-pressed', 'false')); if (!was || row.dataset.g === 'treatArch') pk.setAttribute('aria-pressed', 'true'); }
      if (row.dataset.g === 'lab') row.dataset.manual = '1';
      if (row.dataset.g === 'appliances') routeLab(root, isNew);
      refresh(false); return;
    }
    const at = e.target.closest('.aTiles .aTile');
    if (at && root.contains(at)) { const row = at.closest('.aTiles'), inp = $('#' + row.dataset.for, root); if (inp) { inp.value = at.dataset.v; inp.dataset.manual = '1'; assignTilesSync(root); } return; }
    const ship = e.target.closest('#cf-ship');
    if (ship && root.contains(ship)) {
      const on = ship.getAttribute('aria-pressed') !== 'true'; ship.setAttribute('aria-pressed', String(on));
      // shipped straight to the patient means no visit for IPR or attachments (Amir, 2 Oct 2026): switch both on,
      // and off again with the switch unless someone changed them in between
      const ipr = $r('.pickRow[data-g=extras] .pick[data-v="No IPR"]'), na = $r('#cf-noatt');
      if (on) {
        if (ipr && ipr.getAttribute('aria-pressed') !== 'true') { ipr.setAttribute('aria-pressed', 'true'); ipr.dataset.byShip = '1'; }
        const t = readTeeth();
        if (na && noattScopeOf(t) !== 'all') { ALL_TEETH.forEach(k => setMark(t, k, 'noatt', !isMissing(t, k))); drawTeeth(t); syncNoatt('all'); na.dataset.byShip = '1'; }
      } else {
        if (ipr && ipr.dataset.byShip === '1' && ipr.getAttribute('aria-pressed') === 'true') ipr.setAttribute('aria-pressed', 'false');
        if (na && na.dataset.byShip === '1') { const t = readTeeth(); if (noattScopeOf(t) === 'all') { ALL_TEETH.forEach(k => setMark(t, k, 'noatt', false)); drawTeeth(t); $r('#cf-noattScope').hidden = true; syncNoatt(); } }
        if (ipr) delete ipr.dataset.byShip; if (na) delete na.dataset.byShip;
      }
      return;
    }
    const tool = e.target.closest('.tcTools [data-tool]');
    if (tool && root.contains(tool)) { $$('.tcTools [data-tool]', root).forEach(b => b.setAttribute('aria-checked', String(b === tool))); return; }
    const nat = e.target.closest('#cf-noatt');
    if (nat && root.contains(nat)) {
      if (nat.getAttribute('aria-pressed') === 'true') { const t = readTeeth(); ALL_TEETH.forEach(k => setMark(t, k, 'noatt', false)); drawTeeth(t); $r('#cf-noattScope').hidden = true; }
      else { nat.setAttribute('aria-pressed', 'true'); $r('#cf-noattScope').hidden = false; }
      syncNoatt(); return;
    }
    const scp = e.target.closest('#cf-noattScope [data-scope]');
    if (scp && root.contains(scp)) {
      const sc = NOATT_SCOPES.find(x => x.v === scp.dataset.scope);
      if (sc.teeth) { const t = readTeeth(); ALL_TEETH.forEach(k => setMark(t, k, 'noatt', sc.teeth.includes(k) && !isMissing(t, k))); drawTeeth(t); }
      else { setTool('noatt'); $r('#cf-tcChart').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      $$('#cf-noattScope [data-scope]', root).forEach(b => b.setAttribute('aria-pressed', String(b === scp)));
      syncNoatt(sc.v); return;
    }
    const tq = e.target.closest('.tcQuick [data-tq]'), tooth = e.target.closest('#cf-tc .tooth');
    if ((tq || tooth) && root.contains(tq || tooth)) {
      const mk = (($('.tcTools [data-tool][aria-checked="true"]', root) || {}).dataset || {}).tool || 'noatt';
      let t = readTeeth(); const has = k => (t[k] || []).includes(mk);
      if (tooth) setMark(t, tooth.dataset.t, mk, !has(tooth.dataset.t));
      else if (tq.dataset.tq === 'clear') t = {};
      else { // whole groups skip missing teeth (unless marking them missing)
        const list = ({ uant: UPPER_ANT, ant: ANTERIORS, post: POSTERIORS }[tq.dataset.tq] || ALL_TEETH).filter(k => mk === 'missing' || !isMissing(t, k));
        const allOn = list.every(has); list.forEach(k => setMark(t, k, mk, !allOn));
      }
      const refocus = tooth && document.activeElement === tooth ? tooth.dataset.t : '';
      drawTeeth(t); syncNoatt();
      if (refocus) { const el = $r('#cf-tcChart .tooth[data-t="' + refocus + '"]'); if (el) el.focus(); }
      return;
    }
    const sc = e.target.closest('[data-scan]');
    if (sc && root.contains(sc)) { $r('#cf-scanDate').value = addDays(todayISO(), Number(sc.dataset.scan)); refresh(false); return; }
    const cc = e.target.closest('.pick[data-cc]');
    if (cc && root.contains(cc)) { $r('#cf-cc').value = cc.dataset.cc === 'None' ? 'None' : cc.dataset.cc; return; }
  });
  // teeth: read, draw, and keep the "No attachments" tile in step with the chart
  const readTeeth = () => { try { return JSON.parse($r('#cf-teeth').value || '{}'); } catch (x) { return {}; } };
  const drawTeeth = t => { t = canonTeeth(t); $r('#cf-teeth').value = JSON.stringify(t); $r('#cf-tcChart').innerHTML = toothChartHTML(t, false); $r('#cf-teethSum').textContent = teethSummary(t) || 'Pick a marker, then tap teeth.'; };
  const setTool = k => $$('.tcTools [data-tool]', root).forEach(b => b.setAttribute('aria-checked', String(b.dataset.tool === k)));
  const syncNoatt = picked => {
    const tile = $r('#cf-noatt'); if (!tile) return;
    const t = readTeeth(), scope = noattScopeOf(t), n = ALL_TEETH.filter(k => (t[k] || []).includes('noatt')).length;
    const on = !!scope || (tile.getAttribute('aria-pressed') === 'true' && !$r('#cf-noattScope').hidden);
    tile.setAttribute('aria-pressed', String(on)); $r('#cf-noattScope').hidden = !on;
    const shown = scope || (picked === 'pick' ? 'pick' : '');
    $$('#cf-noattScope [data-scope]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === shown)));
    $r('#cf-noattSub').textContent = scope === 'pick' ? n + (n === 1 ? ' tooth' : ' teeth') : scope ? NOATT_SCOPES.find(x => x.v === scope).l : on ? 'Choose where' : '';
  };
  root.addEventListener('keydown', e => {
    const tooth = e.target.closest && e.target.closest('#cf-tc .tooth');
    if (tooth && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tooth.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  $r('#cf-stage').addEventListener('change', e => { e.target.dataset.manual = '1'; }); // (Assigned to: marked by its tiles)
  // editing: a lab already on the case stays unless someone taps another one
  const labRow = $('.pickRow[data-g="lab"]', root); if (!isNew && labRow && pressed(root, 'lab').length) labRow.dataset.manual = '1';
  $r('#cf-scanDate').addEventListener('change', () => refresh(false));
  $r('#cf-scanDate').addEventListener('input', () => refresh(false));
  refresh(false);
}
/* pre-select the lab for the tapped appliances (unless someone picked a lab by hand); in-house D2 starts in fabrication with Dr. A */
function routeLab(root, isNew) {
  const marpe = ($('#cf-tile', root) || {}).value === 'marpe';
  const ap = marpe ? ['MARPE'] : pressed(root, 'appliances'); const labs = Array.from(new Set(ap.map(a => LAB_FOR[a]).filter(Boolean)));
  const row = $('.pickRow[data-g="lab"]', root); const hint = $('#cf-labHint', root);
  if (row && row.dataset.manual !== '1') { $$('.pick', row).forEach(b => b.setAttribute('aria-pressed', 'false')); if (labs[0]) setPick(root, 'lab', labs[0], true); }
  if (hint) hint.textContent = labs.length > 1 ? 'These go to different labs (' + labs.join(', ') + ') — make one case per lab.' : labs.length ? 'Lab picked from the office routing — tap another to change.' : '';
  if (hint) hint.style.color = labs.length > 1 ? 'var(--coral-700)' : 'var(--grey-500)';
  if (!isNew || marpe) return; // a MARPE case starts at its first step (records) with the default person
  const inHouse = labs.length === 1 && labs[0] === LAB_IN;
  const st = $('#cf-stage', root), as = $('#cf-assignee', root);
  if (st && st.dataset.manual !== '1') st.value = inHouse ? 'mfg' : 'submit';
  if (as && as.dataset.manual !== '1') as.value = inHouse ? ((activeRoster().find(r => r.role === 'owner') || {}).sid || '') : defaultAssignee('appliance');
  assignTilesSync(root);
}
/* a case's assistant who has since left still shows (picked) when the case is edited */
function withSavedStaff(list, sid) { if (!sid || list.some(r => r.sid === sid)) return list; const r = staff(sid); return r ? list.concat([r]) : list; }
function setPick(root, g, v, on) { const b = $('.pickRow[data-g="' + g + '"] .pick[data-v="' + CSS.escape(v) + '"]', root); if (b) b.setAttribute('aria-pressed', String(!!on)); }
function editDirty() {
  const d = $('#drawer'); if (!d || !S.editing || !S.editBase) return false;
  const now = readCaseForm(d); return FORM_KEYS.some(k => !sameVal(now[k], S.editBase[k])) || (now.variant || '') !== (S.editBase.variant || '');
}
function newCaseModal() {
  const roster = activeRoster().filter(r => r.role !== 'owner');
  const base = { scanDate: todayISO(), assistant: roster.some(r => r.sid === meSid()) ? meSid() : '' };
  openModal('<h3>New case</h3><div class="lsub">Tap through it after the scan. Only the patient’s name needs typing. Encrypted before it leaves this computer.</div><div id="ncErr"></div><form id="ncForm" novalidate>' + caseFormHTML(base, true) +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-teal" type="submit" id="ncSave">' + ic('plus', 16) + 'Create case</button></div></form>', w => {
      w.querySelector('.modal').classList.add('wide');
      wireCaseForm(w, true); phWireForm(w); savPaint(w);
      $('#ncForm', w).onsubmit = async e => {
        e.preventDefault(); const data = readCaseForm(w);
        const err = m => { $('#ncErr', w).innerHTML = '<div class="lockErr" role="alert">' + esc(m) + '</div>'; $('#ncErr', w).scrollIntoView({ block: 'nearest' }); };
        if (!data.type) return err('Tap a case type.');
        if (!data.patient) return err('Enter the patient’s name.');
        if (data.titanUrl && !safeUrl(data.titanUrl)) return err('The Titan link must start with https://');
        data.stage = data.stage || firstStage(data.type);
        const needs = stageNeeds(Object.assign({}, data, { stage: firstStage(data.type) }), data.stage);
        if (needs.includes('records')) return err('Tick both records (STL scan and CBCT) before starting it at ' + stageLabel(data) + '.');
        if (needs.includes('zoom')) return err('Add the Zoom call date to start it at Zoom call scheduled.');
        if (needs.includes('aligners') && alignersMissing(data)) return err('Enter ' + alAskText(data) + ' and pick Attachment templates to start it at ' + stageLabel(data) + '.');
        Object.assign(data, { comments: [], createdAt: Date.now(), createdBy: meSid() });
        busyBtn($('#ncSave', w), true, 'Saving…');
        try {
          await B.createCase(data, w._ph ? w._ph.bytes : null); closeModal();
          toast('Case created for ' + data.patient, { action: 'Copy chart note', ms: 12000, onAction: () => copyText(chartNote(data)).then(ok => toast(ok ? 'Chart note copied — paste it into the patient’s chart' : 'Couldn’t copy — open the case to copy its chart note', ok ? {} : { bad: true })) });
        }
        catch (x) { busyBtn($('#ncSave', w), false); err(errText(x)); }
      };
    });
}
