/* ================= Face diagrams (SVG) =================
   Front view: centred on x = 200. The viewer's LEFT is the patient's RIGHT (as when facing the patient).
   Lateral view: drawn as the patient's RIGHT side, face toward the viewer's left.
   The LEFT side is its mirror image (x -> 400 - x).
   Scale: about 1.75 drawing units per mm (nasion to menton is about 120 mm). */

var MM = 1.75;
function mxv(x) { return 400 - x; }

/* Mirror an absolute path that uses only M/L/C/Q/Z with x,y pairs. */
function mirrorPath(d) {
  return d.replace(/(-?\d*\.?\d+)[\s,]+(-?\d*\.?\d+)/g, function (m, x, y) {
    return (400 - parseFloat(x)).toFixed(1) + ' ' + y;
  });
}

/* Head outline: patient-right half as cubic segments, joined to its mirror. */
var FRONT_HALF = [[200, 28], [132, 28, 74, 70, 72, 140], [70, 175, 74, 200, 76, 218], [78, 260, 88, 300, 100, 330], [112, 356, 138, 374, 162, 382], [176, 386, 188, 388, 200, 388]];
function frontOutline() {
  var h = FRONT_HALF, d = 'M ' + h[0][0] + ' ' + h[0][1];
  for (var i = 1; i < h.length; i++) d += ' C ' + h[i].join(' ');
  // back up the other side: reverse each segment and mirror it
  for (var j = h.length - 1; j >= 1; j--) {
    var s = h[j], p0 = h[j - 1], end = p0.length === 2 ? p0 : [p0[4], p0[5]];
    d += ' C ' + mxv(s[2]) + ' ' + s[3] + ' ' + mxv(s[0]) + ' ' + s[1] + ' ' + mxv(end[0]) + ' ' + end[1];
  }
  return d + ' Z';
}

var FRONT = {
  hair: 'M 72 150 C 66 80 120 30 200 30 C 280 30 334 80 328 150 C 318 128 306 112 288 104 C 262 88 232 80 200 80 C 168 80 138 88 112 104 C 94 112 82 128 72 150 Z',
  ear: 'M 77 194 C 64 184 50 190 48 212 C 46 236 50 256 58 270 C 64 282 74 288 80 282',
  earIn: 'M 68 208 C 60 214 60 238 66 254',
  brow: 'M 124 162 C 136 152 156 150 178 158',
  eye: 'M 130 189 C 140 178 164 177 176 188 C 164 196 142 197 130 189 Z',
  lid: 'M 133 181 C 144 171 162 171 173 179',
  iris: [153, 188],
  noseSide: 'M 188 198 C 186 216 184 232 184 247',
  ala: 'M 186 250 C 172 252 168 266 178 272 C 183 275 189 273 192 270',
  nostril: [187, 269],
  nlf: 'M 172 268 C 160 282 152 298 150 318',
  marionette: 'M 160 314 C 156 336 154 354 152 372',
  neck: 'M 152 377 C 152 410 150 440 146 476',
  /* centre pieces, drawn once */
  noseTip: 'M 192 270 C 196 275 204 275 208 270',
  upperLip: 'M 158 308 C 170 302 182 294 192 294 C 196 294 198 297 200 298 C 202 297 204 294 208 294 C 218 294 230 302 242 308 C 220 311 180 311 158 308 Z',
  lowerLip: 'M 158 308 C 180 311 220 311 242 308 C 228 322 212 328 200 328 C 188 328 172 322 158 308 Z',
  stomion: 'M 158 308 C 180 311 220 311 242 308',
  philtrum: 'M 194 294 L 195 274 M 206 294 L 205 274',
  mentolabial: 'M 184 342 C 192 338 208 338 216 342',
  chin: 'M 182 371 C 192 376 208 376 218 371'
};

/* Muscles, patient-right side (mirrored for the left). lp = label position (right side). */
var FRONT_MUSCLES = {
  temporalis: { d: 'M 74 124 C 82 116 94 120 100 132 L 96 198 L 80 202 C 76 174 74 150 74 124 Z', name: 'Temporalis', lp: [87, 112] },
  masseter: { d: 'M 80 228 L 96 230 C 100 270 106 304 114 336 L 102 338 C 92 304 84 266 80 228 Z', name: 'Masseter', lp: [92, 222] },
  llsan: { d: 'M 190 194 C 186 222 182 248 178 270 L 172 296 L 164 294 L 170 268 C 174 244 178 220 182 194 Z', name: 'LLSAN', lp: [188, 188] },
  lls: { d: 'M 168 206 L 140 208 C 146 240 154 272 160 298 L 174 296 C 170 266 166 236 168 206 Z', name: 'LLS', lp: [150, 216] },
  zmi: { d: 'M 122 222 L 134 218 L 172 296 L 162 298 Z', name: 'Zyg. minor', lp: [116, 216] },
  zmj: { d: 'M 100 232 L 112 224 L 160 304 L 152 312 Z', name: 'Zyg. major', lp: [104, 242] },
  risorius: { d: 'M 86 300 L 154 306 L 154 313 L 88 308 Z', name: 'Risorius', lp: [100, 298] },
  dao: { d: 'M 160 312 L 157 380 L 116 368 Z', name: 'DAO', lp: [130, 388] },
  dli: { d: 'M 176 326 L 192 328 L 186 386 L 162 382 Z', name: 'DLI', lp: [171, 398] },
  mentalis: { d: 'M 197 342 L 186 344 C 180 356 182 368 188 378 L 198 380 Z', name: 'Mentalis', lp: [200, 404] },
  frontalis: { d: 'M 198 86 C 168 86 140 94 120 108 C 114 122 114 136 118 150 C 140 146 170 146 197 152 Z', name: 'Frontalis' },
  corrugator: { d: 'M 194 168 C 184 160 170 150 152 143 L 150 150 C 166 155 180 163 190 172 Z', name: 'Corrugator' }
};
/* Centred or ring-shaped muscles, drawn once / per eye. */
var PROCERUS = 'M 193 150 L 207 150 L 208 186 L 192 186 Z';
/* Orbicularis oculi (patient right): wider laterally, where crow's feet are treated; the eye opening is cut out. */
var OCULI = 'M 186 160 C 160 148 116 150 96 170 C 86 184 88 204 98 218 C 114 234 162 236 188 214 C 194 196 194 176 186 160 Z';
function oculiPath(left) {
  var cx = left ? mxv(153) : 153;
  return (left ? mirrorPath(OCULI) : OCULI) + ' M ' + (cx - 24) + ' 189 A 24 11 0 1 1 ' + (cx + 24) + ' 189 A 24 11 0 1 1 ' + (cx - 24) + ' 189 Z';
}
function ringPath(cx, cy, rxo, ryo, rxi, ryi) {
  return 'M ' + (cx - rxo) + ' ' + cy + ' A ' + rxo + ' ' + ryo + ' 0 1 0 ' + (cx + rxo) + ' ' + cy + ' A ' + rxo + ' ' + ryo + ' 0 1 0 ' + (cx - rxo) + ' ' + cy + ' Z ' +
    'M ' + (cx - rxi) + ' ' + cy + ' A ' + rxi + ' ' + ryi + ' 0 1 1 ' + (cx + rxi) + ' ' + cy + ' A ' + rxi + ' ' + ryi + ' 0 1 1 ' + (cx - rxi) + ' ' + cy + ' Z';
}
/* Orbicularis oris ring is centred; drawn once. */
var OO_RING = 'M 146 310 A 54 34 0 1 0 254 310 A 54 34 0 1 0 146 310 Z M 162 310 A 38 17 0 1 1 238 310 A 38 17 0 1 1 162 310 Z';

/* Front-view neck fill (drawn under the head). */
var FRONT_NECK = 'M 152 377 C 152 410 150 440 146 476 L 254 476 C 250 440 248 410 248 377 Z';

var LAT = {
  face: 'M 230 30 C 170 30 122 52 108 96 C 100 120 98 146 100 160 C 101 168 104 176 108 180 C 96 206 80 232 64 250 C 60 256 64 262 72 264 C 80 266 86 268 90 270 C 86 280 84 288 86 294 C 88 300 92 304 94 306 C 90 310 88 316 90 322 C 94 330 100 336 102 340 C 96 350 92 360 96 370 C 100 382 110 388 124 390 C 140 392 156 396 166 404 C 170 430 170 450 168 476',
  backRev: ' L 296 476 C 294 380 300 330 314 300 C 330 262 342 214 344 156 C 346 84 300 30 230 30 Z',
  back: 'M 230 30 C 300 30 346 84 344 156 C 342 214 330 262 314 300 C 300 330 294 380 296 476',
  hair: 'M 110 92 C 128 56 174 30 230 30 C 300 30 346 84 344 156 C 342 196 336 224 324 248 C 316 228 304 212 290 200 C 278 190 262 184 248 182 C 238 182 232 188 230 198 L 229 222 C 222 206 216 192 210 180 C 196 148 162 112 110 92 Z',
  ear: 'M 236 192 C 250 180 278 182 284 208 C 290 232 284 258 270 276 C 262 288 252 292 244 286 C 238 280 240 270 236 262',
  earIn: 'M 246 204 C 262 198 272 214 270 232 C 268 248 260 258 252 262',
  tragus: 'M 237 226 C 230 230 230 242 237 246',
  eye: 'M 112 187 C 118 182 128 182 136 188 C 128 192 118 192 112 187 Z',
  lid: 'M 112 184 C 118 178 130 178 138 184',
  brow: 'M 104 160 C 116 154 134 152 150 156',
  orbit: 'M 144 170 C 148 182 148 196 142 206',
  ala: 'M 84 256 C 92 248 104 252 104 261 C 104 268 96 270 90 268',
  nlf: 'M 108 268 C 114 282 116 294 114 306',
  mouth: 'M 93 306 C 98 307 102 308 107 309',
  jaw: 'M 124 390 C 150 384 190 368 220 346 C 226 340 228 330 228 318',
  arch: 'M 146 218 C 170 214 200 216 228 222'
};
var LAT_MUSCLES = {
  temporalis: { d: 'M 142 168 C 146 118 196 88 250 92 C 292 98 312 132 304 166 C 298 180 284 184 270 180 C 254 176 240 182 233 194 C 229 205 227 214 223 222 C 200 224 176 222 152 218 C 146 202 142 186 142 168 Z', name: 'Temporalis', lp: [266, 112] },
  masseter: { d: 'M 154 222 C 174 220 200 222 218 228 C 222 262 224 300 222 338 C 214 350 196 358 176 362 C 170 316 162 268 154 222 Z', name: 'Masseter', lp: [150, 372] },
  zmj: { d: 'M 150 222 L 160 226 L 112 306 L 106 303 Z', name: 'Zyg. major', lp: [118, 238] },
  risorius: { d: 'M 214 298 L 112 306 L 112 312 L 214 306 Z', name: 'Risorius', lp: [130, 322] }
};

/* Masseter safe zone (see landmarks): below the tragus-commissure line, 1 cm behind the anterior
   border, 1.5 cm above the lower border of the mandible, in front of the parotid. */
var SAFE_ZONE = [[179.2, 266.6], [214, 246.4], [214, 321.4], [189.8, 335.1]];

var DRAW_VIEWS = {
  front: { full: [30, 24, 340, 440], crop: [40, 118, 320, 292] },
  lat: { full: [40, 24, 320, 440], crop: [50, 70, 300, 330] }
};
/* Close-up boxes (right-side coordinates; mirrored automatically for the left side). */
var ZOOM = { front: [64, 132, 272, 276], upper: [60, 72, 280, 168], face: [52, 62, 296, 344], mass: [58, 172, 262, 236], temp: [92, 66, 236, 196], lat: [58, 66, 268, 342] };
var UPPER_IDS = ['glabella', 'forehead', 'crows'];
function zoomFor(view, ids) {
  if (view === 'front') {
    var up = false, low = false;
    (ids || []).forEach(function (id) { if (UPPER_IDS.indexOf(id) >= 0) up = true; else low = true; });
    return up && low ? ZOOM.face : up ? ZOOM.upper : ZOOM.front;
  }
  var m = false, t = false;
  (ids || []).forEach(function (id) { if (id.indexOf('mass') === 0) m = true; if (id === 'temporalis') t = true; });
  return m && t ? ZOOM.lat : t ? ZOOM.temp : m ? ZOOM.mass : ZOOM.lat;
}

function svgEsc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

/* Rough text width for Montserrat 700 so pills can be laid out before fonts load. */
function textW(t, fs) {
  var w = 0;
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    w += c === ' ' ? 0.28 : c === '.' ? 0.3 : /[0-9]/.test(c) ? 0.64 : /[A-Z]/.test(c) ? 0.74 : 0.6;
  }
  return w * fs;
}

function rectsOverlap(a, b, pad) {
  pad = pad || 0;
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/* Place dose pills next to their dots without overlapping each other or other dots. */
function layoutPills(pts, fs, vb, obstacles) {
  var placed = [], out = [], dr = fs * 0.58;
  var dots = pts.map(function (p) { return { x: p.x - dr, y: p.y - dr, w: dr * 2, h: dr * 2 }; });
  var dirs = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1], tr: [1, -1], tl: [-1, -1], br: [1, 1], bl: [-1, 1] };
  var order = ['r', 'l', 't', 'b', 'tr', 'tl', 'br', 'bl'];
  pts.forEach(function (p, i) {
    var w = textW(p.text, fs) + fs * 1.0, h = fs * 1.55;
    var pref = p.pref || 'r';
    var tries = [pref].concat(order.filter(function (o) { return o !== pref; }));
    var gaps = [fs * 0.75, fs * 1.6, fs * 2.7, fs * 4];
    var best = null;
    outer:
    for (var g = 0; g < gaps.length; g++) {
      for (var k = 0; k < tries.length; k++) {
        var dv = dirs[tries[k]], gap = gaps[g];
        var cx = p.x + dv[0] * (gap + w / 2), cy = p.y + dv[1] * (gap + h / 2);
        if (dv[0] === 0) cx = p.x;
        if (dv[1] === 0) cy = p.y;
        var r = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
        if (r.x < vb[0] + 1 || r.y < vb[1] + 1 || r.x + r.w > vb[0] + vb[2] - 1 || r.y + r.h > vb[1] + vb[3] - 1) continue;
        var clash = placed.some(function (q) { return rectsOverlap(r, q, fs * 0.15); }) ||
          dots.some(function (q, j) { return j !== i && rectsOverlap(r, q, 1); }) ||
          (obstacles || []).some(function (q) { return rectsOverlap(r, q, 1); });
        if (!clash) { best = r; break outer; }
      }
    }
    if (!best) {
      var dv0 = dirs[pref];
      best = { x: p.x + dv0[0] * fs * 0.75 + (dv0[0] < 0 ? -w : dv0[0] > 0 ? 0 : -w / 2), y: p.y - h / 2, w: w, h: h };
    }
    placed.push(best);
    out.push(best);
  });
  return out;
}

/* opt: { pts:[{x,y,text,pref,key,warn,zero,mirror}], hi:[muscle ids], muscles, caution:[ids], marks:[ids],
          vb:[x,y,w,h] (right-side coordinates) or crop, px (drawn width in CSS px) or inch (printed width),
          print, idp, caption }
   Text is sized from the drawn width so labels read the same at every zoom. */
function faceSVG(view, opt) {
  opt = opt || {};
  var lat = view !== 'front', left = view === 'latL';
  var vb = (opt.vb || (lat ? DRAW_VIEWS.lat : DRAW_VIEWS.front)[opt.crop ? 'crop' : 'full']).slice();
  if (left) vb[0] = 400 - vb[0] - vb[2];
  var idp = opt.idp || ('f' + Math.random().toString(36).slice(2, 8));
  var drawnPx = opt.inch ? opt.inch * 96 : (opt.px || 420);
  var fs = (opt.print ? 9.6 : 12) * vb[2] / drawnPx;
  var sfs = fs * 0.8;
  var hi = opt.hi || [], caution = opt.caution || [], marks = opt.marks || [];
  var P = function (d) { return left ? mirrorPath(d) : d; };
  var X = function (x) { return left ? mxv(x) : x; };
  var s = [];
  s.push('<svg class="face" viewBox="' + vb.join(' ') + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
    svgEsc(opt.caption || (lat ? (left ? 'Left side' : 'Right side') : 'Front view')) + '">');
  s.push('<defs>' +
    '<pattern id="' + idp + 'h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect class="hatch-bg" width="6" height="6"/><line class="hatch-ln" x1="0" y1="0" x2="0" y2="6"/></pattern>' +
    '<clipPath id="' + idp + 'c"><path d="' + (lat ? P(LAT.face + LAT.backRev) : frontOutline()) + '"/></clipPath>' +
    (lat ? '<clipPath id="' + idp + 't"><path d="' + P(LAT_MUSCLES.temporalis.d) + '"/></clipPath>' : '') +
    '</defs>');

  if (!lat) {
    var outline = frontOutline();
    s.push('<path class="skin" d="' + FRONT_NECK + '"/>');
    s.push('<path class="hair" d="' + FRONT.hair + '"/>');
    s.push('<path class="skin" d="' + outline + '"/>');
    [FRONT.ear, mirrorPath(FRONT.ear)].forEach(function (e) { s.push('<path class="skin ear" d="' + e + '"/>'); });
    [FRONT.earIn, mirrorPath(FRONT.earIn)].forEach(function (e) { s.push('<path class="ln faint" d="' + e + '"/>'); });
    s.push('<path class="hair" d="' + FRONT.hair + '"/>');
    s.push('<path class="ln outline" d="' + outline + '"/>');
    [FRONT.neck, mirrorPath(FRONT.neck)].forEach(function (e) { s.push('<path class="ln" d="' + e + '"/>'); });

    if (opt.muscles) {
      s.push('<g clip-path="url(#' + idp + 'c)">');
      if (hi.indexOf('oo') >= 0) s.push('<path class="mus hi" fill-rule="evenodd" d="' + OO_RING + '"/>');
      if (hi.indexOf('procerus') >= 0) s.push('<path class="mus hi" d="' + PROCERUS + '"/>');
      if (hi.indexOf('oculi') >= 0) {
        s.push('<path class="mus hi" fill-rule="evenodd" d="' + oculiPath(false) + '"/>');
        s.push('<path class="mus hi" fill-rule="evenodd" d="' + oculiPath(true) + '"/>');
      }
      Object.keys(FRONT_MUSCLES).forEach(function (k) {
        if (hi.indexOf(k) < 0) return;
        var m = FRONT_MUSCLES[k];
        s.push('<path class="mus hi" d="' + m.d + '"/>');
        s.push('<path class="mus hi" d="' + mirrorPath(m.d) + '"/>');
      });
      s.push('</g>');
    }

    /* features */
    [FRONT.brow, mirrorPath(FRONT.brow)].forEach(function (e) { s.push('<path class="brow" d="' + e + '"/>'); });
    [FRONT.eye, mirrorPath(FRONT.eye)].forEach(function (e) { s.push('<path class="eye" d="' + e + '"/>'); });
    [FRONT.lid, mirrorPath(FRONT.lid)].forEach(function (e) { s.push('<path class="ln faint" d="' + e + '"/>'); });
    [FRONT.iris[0], mxv(FRONT.iris[0])].forEach(function (x) {
      s.push('<circle class="iris" cx="' + x + '" cy="' + FRONT.iris[1] + '" r="6.4"/><circle class="pupil" cx="' + x + '" cy="' + FRONT.iris[1] + '" r="2.6"/>');
    });
    [FRONT.noseSide, mirrorPath(FRONT.noseSide)].forEach(function (e) { s.push('<path class="ln faint" d="' + e + '"/>'); });
    [FRONT.ala, mirrorPath(FRONT.ala)].forEach(function (e) { s.push('<path class="ln" d="' + e + '"/>'); });
    [FRONT.nostril[0], mxv(FRONT.nostril[0])].forEach(function (x, i) {
      s.push('<ellipse class="nostril" cx="' + x + '" cy="' + FRONT.nostril[1] + '" rx="5.4" ry="2.6" transform="rotate(' + (i ? -14 : 14) + ' ' + x + ' ' + FRONT.nostril[1] + ')"/>');
    });
    s.push('<path class="ln" d="' + FRONT.noseTip + '"/>');
    [FRONT.nlf, mirrorPath(FRONT.nlf)].forEach(function (e) { s.push('<path class="ln faint" d="' + e + '"/>'); });
    s.push('<path class="lip" d="' + FRONT.upperLip + '"/><path class="lip" d="' + FRONT.lowerLip + '"/>');
    s.push('<path class="ln" d="' + FRONT.stomion + '"/>');
    s.push('<path class="ln faint" d="' + FRONT.philtrum + '"/>');
    s.push('<path class="ln faint" d="' + FRONT.mentolabial + '"/>');
    s.push('<path class="ln faint" d="' + FRONT.chin + '"/>');
    if (marks.indexOf('marionette') >= 0) {
      [FRONT.marionette, mirrorPath(FRONT.marionette)].forEach(function (e) { s.push('<path class="mark-line" d="' + e + '"/>'); });
    } else {
      [FRONT.marionette, mirrorPath(FRONT.marionette)].forEach(function (e) { s.push('<path class="ln faint" d="' + e + '"/>'); });
    }

    /* caution overlays */
    if (caution.indexOf('zmj') >= 0) {
      s.push('<g clip-path="url(#' + idp + 'c)"><path class="caution" fill="url(#' + idp + 'h)" d="' + FRONT_MUSCLES.zmj.d + '"/><path class="caution" fill="url(#' + idp + 'h)" d="' + mirrorPath(FRONT_MUSCLES.zmj.d) + '"/></g>');
    }
    if (caution.indexOf('dli') >= 0) {
      s.push('<g clip-path="url(#' + idp + 'c)"><path class="caution" fill="url(#' + idp + 'h)" d="' + FRONT_MUSCLES.dli.d + '"/><path class="caution" fill="url(#' + idp + 'h)" d="' + mirrorPath(FRONT_MUSCLES.dli.d) + '"/></g>');
    }
    if (caution.indexOf('oo-low') >= 0) {
      s.push('<path class="caution" fill="url(#' + idp + 'h)" d="M 176 330 C 190 333 210 333 224 330 L 226 357 C 210 360 190 360 174 357 Z"/>');
    }
    if (caution.indexOf('brow-band') >= 0) {
      s.push('<g clip-path="url(#' + idp + 'c)"><path class="caution" fill="url(#' + idp + 'h)" d="M 112 119.5 L 288 119.5 L 288 150 C 260 146 230 150 212 157 L 200 160 L 188 157 C 170 150 140 146 112 150 Z"/></g>');
    }
    if (caution.indexOf('levator') >= 0) {
      [153, mxv(153)].forEach(function (cx) { s.push('<ellipse class="caution" fill="url(#' + idp + 'h)" cx="' + cx + '" cy="172" rx="25" ry="9"/>'); });
    }
    if (caution.indexOf('orbit') >= 0) {
      [153, mxv(153)].forEach(function (cx) { s.push('<path class="caution" fill-rule="evenodd" fill="url(#' + idp + 'h)" d="' + ringPath(cx, 189, 33, 24, 24, 10.5) + '"/>'); });
    }
    if (caution.indexOf('corners') >= 0) {
      s.push('<circle class="caution" fill="url(#' + idp + 'h)" cx="158" cy="308" r="' + (1.5 * MM * 10).toFixed(1) + '"/>');
      s.push('<circle class="caution" fill="url(#' + idp + 'h)" cx="242" cy="308" r="' + (1.5 * MM * 10).toFixed(1) + '"/>');
    }

    /* landmarks */
    if (marks.indexOf('brow2cm') >= 0) {
      s.push('<line class="mark-line" x1="116" y1="119.5" x2="284" y2="119.5"/>');
      s.push('<text class="mark-txt" x="284" y="' + (119.5 + sfs * 1.25).toFixed(1) + '" text-anchor="end" font-size="' + sfs.toFixed(2) + '">2 cm above brow</text>');
    }
    if (marks.indexOf('rim1cm') >= 0) {
      s.push('<g class="dim"><line x1="146" y1="136" x2="146" y2="152"/><line x1="142" y1="136" x2="150" y2="136"/><line x1="142" y1="152" x2="150" y2="152"/>' +
        '<text x="141" y="147" text-anchor="end" font-size="' + sfs.toFixed(2) + '">1 cm</text></g>');
    }
    if (marks.indexOf('canthus') >= 0) {
      s.push('<g class="dim"><line x1="100" y1="181" x2="130" y2="181"/><line x1="100" y1="177" x2="100" y2="185"/><line x1="130" y1="177" x2="130" y2="185"/>' +
        '<text x="115" y="' + (181 - sfs * 0.45).toFixed(1) + '" text-anchor="middle" font-size="' + sfs.toFixed(2) + '">1.5\u20132 cm</text></g>');
    }
    if (marks.indexOf('lipline') >= 0) {
      s.push('<line class="mark-line" x1="112" y1="308" x2="288" y2="308"/>');
      s.push('<text class="mark-txt" x="100" y="320" font-size="' + sfs.toFixed(2) + '">commissure line</text>');
    }
    if (marks.indexOf('yonsei') >= 0) {
      // 1 cm lateral to the ala, 3 cm above the commissure line
      s.push('<g class="dim"><line x1="152" y1="244" x2="170" y2="244"/><line x1="152" y1="240" x2="152" y2="248"/><line x1="170" y1="240" x2="170" y2="248"/>' +
        '<text x="161" y="238" text-anchor="middle" font-size="' + sfs.toFixed(2) + '">1 cm</text>' +
        '<line x1="138" y1="252" x2="138" y2="308"/><line x1="134" y1="252" x2="142" y2="252"/><line x1="134" y1="308" x2="142" y2="308"/>' +
        '<text x="133" y="284" text-anchor="end" font-size="' + sfs.toFixed(2) + '">3 cm</text></g>');
    }
    if (marks.indexOf('sulcus') >= 0) {
      s.push('<line class="mark-line" x1="170" y1="359.5" x2="230" y2="359.5"/>');
      s.push('<text class="mark-txt" x="233" y="362" font-size="' + sfs.toFixed(2) + '">1 cm below sulcus</text>');
    }
    if (marks.indexOf('nlf') >= 0) {
      [FRONT.nlf, mirrorPath(FRONT.nlf)].forEach(function (e) { s.push('<path class="mark-line" d="' + e + '"/>'); });
    }
  } else {
    /* ---------- lateral ---------- */
    s.push('<path class="skin" d="' + P(LAT.face + LAT.backRev) + '"/>');
    s.push('<path class="hair" d="' + P(LAT.hair) + '"/>');
    s.push('<path class="ln outline" d="' + P(LAT.face) + '"/>');
    s.push('<path class="ln outline" d="' + P(LAT.back) + '"/>');
    if (opt.muscles) {
      s.push('<g clip-path="url(#' + idp + 'c)">');
      Object.keys(LAT_MUSCLES).forEach(function (k) {
        if (hi.indexOf(k) < 0) return;
        s.push('<path class="mus hi" d="' + P(LAT_MUSCLES[k].d) + '"/>');
      });
      s.push('</g>');
    }
    s.push('<path class="ln faint" d="' + P(LAT.arch) + '"/>');
    s.push('<path class="ln faint" d="' + P(LAT.jaw) + '"/>');
    s.push('<path class="skin ear" d="' + P(LAT.ear) + '"/>');
    s.push('<path class="ln faint" d="' + P(LAT.earIn) + '"/>');
    s.push('<path class="ln" d="' + P(LAT.tragus) + '"/>');
    s.push('<path class="eye" d="' + P(LAT.eye) + '"/>');
    s.push('<path class="ln faint" d="' + P(LAT.lid) + '"/>');
    s.push('<path class="brow" d="' + P(LAT.brow) + '"/>');
    s.push('<path class="ln faint" d="' + P(LAT.orbit) + '"/>');
    s.push('<path class="ln" d="' + P(LAT.ala) + '"/>');
    s.push('<path class="ln faint" d="' + P(LAT.nlf) + '"/>');
    s.push('<path class="ln" d="' + P(LAT.mouth) + '"/>');

    if (caution.indexOf('tendon') >= 0) {
      s.push('<g clip-path="url(#' + idp + 't)"><rect class="caution soft" fill="url(#' + idp + 'h)" x="0" y="137" width="400" height="90"/></g>');
    }
    if (caution.indexOf('parotid') >= 0) {
      s.push('<path class="caution" fill="url(#' + idp + 'h)" d="' + P('M 218 236 C 232 236 242 254 242 280 C 242 302 234 318 224 322 C 220 300 218 266 218 236 Z') + '"/>');
    }
    if (caution.indexOf('ant') >= 0) {
      s.push('<g clip-path="url(#' + idp + 'c)"><path class="caution" fill="url(#' + idp + 'h)" d="' + P(LAT_MUSCLES.risorius.d) + '"/><path class="caution" fill="url(#' + idp + 'h)" d="' + P(LAT_MUSCLES.zmj.d) + '"/></g>');
    }
    if (caution.indexOf('facial-a') >= 0) {
      s.push('<path class="vessel" d="' + P('M 178 366 C 166 352 150 336 132 324 C 122 318 114 314 108 312') + '"/>');
    }
    if (caution.indexOf('mm-nerve') >= 0) {
      s.push('<path class="nerve" d="' + P('M 222 346 C 204 358 180 368 150 378') + '"/>');
    }
    if (caution.indexOf('sta') >= 0) {
      s.push('<path class="vessel" d="' + P('M 229 244 C 231 220 231 200 227 186 C 214 168 186 160 152 156') + '"/>');
    }

    if (marks.indexOf('safe') >= 0) {
      s.push('<polygon class="safe" points="' + SAFE_ZONE.map(function (q) { return X(q[0]) + ',' + q[1]; }).join(' ') + '"/>');
    }
    if (marks.indexOf('tc') >= 0) {
      s.push('<line class="mark-line" x1="' + X(232) + '" y1="236" x2="' + X(106) + '" y2="309"/>');
    }
    if (marks.indexOf('low1') >= 0) {
      s.push('<line class="mark-line" x1="' + X(172) + '" y1="345.2" x2="' + X(222) + '" y2="316.8"/>');
    }
    if (marks.indexOf('ant1') >= 0) {
      s.push('<line class="mark-line" x1="' + X(176) + '" y1="246" x2="' + X(193) + '" y2="356"/>');
    }
    if (marks.indexOf('thumb') >= 0) {
      s.push('<g clip-path="url(#' + idp + 't)"><line class="mark-line" x1="0" y1="137" x2="400" y2="137"/></g>');
      s.push('<g class="dim"><line x1="' + X(286) + '" y1="137" x2="' + X(286) + '" y2="216"/><line x1="' + X(281) + '" y1="137" x2="' + X(291) + '" y2="137"/><line x1="' + X(281) + '" y1="216" x2="' + X(291) + '" y2="216"/>' +
        '<text x="' + X(291) + '" y="180" text-anchor="' + (left ? 'end' : 'start') + '" font-size="' + sfs.toFixed(2) + '">4.5 cm</text></g>');
    }
  }

  /* muscle labels for highlighted muscles (patient-right side only on the front view) */
  var obstacles = [];
  if (lat && opt.muscles && hi.length && !opt.noLabels) {
    hi.forEach(function (k) {
      var m = lat ? LAT_MUSCLES[k] : FRONT_MUSCLES[k];
      if (!m || !m.lp) return;
      var x = lat ? X(m.lp[0]) : m.lp[0], y = m.lp[1], w = textW(m.name, sfs) * 0.95;
      s.push('<text class="mus-lbl" x="' + x + '" y="' + y + '" text-anchor="middle" font-size="' + sfs.toFixed(2) + '">' + svgEsc(m.name) + '</text>');
      obstacles.push({ x: x - w / 2, y: y - sfs, w: w, h: sfs * 1.25 });
    });
  }

  /* points + dose pills. A site at 0 U (an optional site) is drawn as a hollow dot with no pill. */
  var pts = (opt.pts || []).map(function (p) {
    var pref = p.pref || 'r';
    if (left || p.mirror) pref = pref.replace(/r|l/g, function (c) { return c === 'r' ? 'l' : 'r'; });
    return { x: p.x, y: p.y, text: p.text, pref: pref, key: p.key, warn: p.warn, zero: p.zero, nopill: p.nopill };
  });
  /* nopill: a dot without a dose label (the chairside card labels one side only) */
  var shown = pts.filter(function (p) { return !p.zero && !p.nopill; }), dr0 = fs * 0.58;
  var hollow = pts.filter(function (p) { return p.zero || p.nopill; }).map(function (p) { return { x: p.x - dr0, y: p.y - dr0, w: dr0 * 2, h: dr0 * 2 }; });
  var rects = layoutPills(shown, fs, vb, obstacles.concat(hollow));
  shown.forEach(function (p, i) {
    var r = rects[i];
    var ex = Math.max(r.x, Math.min(p.x, r.x + r.w)), ey = Math.max(r.y, Math.min(p.y, r.y + r.h));
    if (Math.hypot(ex - p.x, ey - p.y) > fs * 0.95) {
      s.push('<line class="leader" x1="' + p.x + '" y1="' + p.y + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>');
    }
  });
  pts.forEach(function (p) {
    s.push('<g class="pt' + (p.zero ? ' zero' : '') + '" data-key="' + svgEsc(p.key || '') + '"><circle class="pt-halo" cx="' + p.x + '" cy="' + p.y + '" r="' + (fs * 0.72).toFixed(2) + '"/>' +
      '<circle class="pt-dot" cx="' + p.x + '" cy="' + p.y + '" r="' + (fs * 0.4).toFixed(2) + '"/></g>');
  });
  shown.forEach(function (p, i) {
    var r = rects[i];
    s.push('<g class="pill' + (p.warn ? ' warn' : '') + (p.zero ? ' zero' : '') + '" data-key="' + svgEsc(p.key || '') + '"><rect x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" width="' + r.w.toFixed(1) + '" height="' + r.h + '" rx="' + (r.h / 2).toFixed(1) + '"/>' +
      '<text x="' + (r.x + r.w / 2).toFixed(1) + '" y="' + (r.y + r.h / 2 + fs * 0.36).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '">' + svgEsc(p.text) + '</text></g>');
  });

  /* orientation captions */
  var cy0 = vb[1] + sfs * 1.5, inset = sfs * 0.8, lfs = ' font-size="' + sfs.toFixed(2) + '"';
  if (!lat) {
    s.push('<text class="side-lbl" x="' + (vb[0] + inset) + '" y="' + cy0 + '"' + lfs + '>R</text>');
    s.push('<text class="side-lbl" x="' + (vb[0] + vb[2] - inset) + '" y="' + cy0 + '" text-anchor="end"' + lfs + '>L</text>');
  } else {
    s.push('<text class="side-lbl" x="' + (left ? vb[0] + vb[2] - inset : vb[0] + inset) + '" y="' + cy0 + '" text-anchor="' + (left ? 'end' : 'start') + '"' + lfs + '>' + (left ? 'LEFT' : 'RIGHT') + '</text>');
  }
  s.push('</svg>');
  return s.join('');
}
