/* =====================================================================
   Units — what a supply is counted in, and what it's bought in.
   - item.unit is what's counted on the shelf and what item.qty is in (box).
     Every price in item.sources[] is per that unit, as it always was.
   - item.buyUnit + item.perBuy say it's bought bigger: gloves are counted
     in boxes and bought by the case of 10 (buyUnit 'case', perBuy 10).
   - The cart and orders work in what's bought (2 cases at the case price);
     receiving 2 cases adds 20 boxes. A line says so itself: line.unit is
     the unit it was ordered in and line.per how many counted units each
     holds (missing on older lines = 1).
   - baseUnitName / orderUnitName / baseUnitsPerOrderUnit (pieces in a box)
     are shown for price-per-piece only and never change a quantity.
   ===================================================================== */
function countUnit(item) { return String((item && item.unit) || 'ea').trim() || 'ea'; }
function perBuy(item) { const n = Number(item && item.perBuy); return item && item.buyUnit && n > 1 ? n : 1; }
function buyUnit(item) { return perBuy(item) > 1 ? String(item.buyUnit).trim() : countUnit(item); }
function buysBigger(item) { return perBuy(item) > 1; }
/* "Case of 10 boxes" */
function buyLabel(item) { return buysBigger(item) ? cap1(buyUnit(item)) + ' of ' + qtyUnit(perBuy(item), countUnit(item)) : cap1(countUnit(item)); }
function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* every vendor that sells it, first = the usual one. A source is { vendor, sku, price (per counted unit), src (product or shop URL) };
   the oldest items carry one flat source (item.src / item.sku / item.price) instead. */
function allSources(item) {
  if (!item) return [];
  if (item.sources) { const arr = listOf(item.sources).filter(Boolean); if (arr.length) return arr; }
  if (item.src || item.price != null || item.sku) return [{ vendor: vendorFromSrc(item.src), sku: item.sku || '', price: item.price != null ? item.price : null, src: item.src || null }];
  return [];
}
function primarySource(item) { return allSources(item)[0] || null; }
function sourceFor(item, vendor) {
  const all = allSources(item); if (!vendor) return all[0] || null;
  return all.find(s => s.vendor === vendor) || all.find(s => vendorNamesSimilar(s.vendor, vendor)) || all[0] || null;
}
/* price per counted unit (box) from a source */
function countPrice(src) { const p = parseFloat(src && src.price); return isFinite(p) && p > 0 ? p : null; }
/* price per bought unit (case) */
function buyPriceOf(item, src) { const p = countPrice(src || primarySource(item)); return p == null ? null : round2(p * perBuy(item)); }
/* the cheapest vendor's price per counted unit, for "cheaper at …" hints */
function cheapestSource(item) { return allSources(item).filter(s => countPrice(s) != null).sort((a, b) => countPrice(a) - countPrice(b))[0] || null; }

/* a cart or order line: how many counted units it adds to stock */
function linePer(line) { const n = Number(line && line.per); return n > 1 ? n : 1; }
function lineStockDelta(line, qty) { return (qty == null ? Number(line && line.qty) || 0 : Number(qty) || 0) * linePer(line); }
/* "2 cases" / "2 cases (20 boxes)" */
function lineQtyLabel(line, withCount) {
  const q = Number(line && line.qty) || 0, u = (line && line.unit) || 'ea';
  let s = qtyUnit(q, u);
  if (withCount && linePer(line) > 1) s += ' (' + qtyUnit(q * linePer(line), line.countUnit || 'ea') + ')';
  return s;
}
/* price per piece, for display only ("$0.09 a glove") */
function perPieceLabel(item, countUnitPrice) {
  const n = Number(item && item.baseUnitsPerOrderUnit), base = item && item.baseUnitName;
  if (!(n > 1) || !base || countUnitPrice == null) return '';
  const unitIsOrder = !item.orderUnitName || String(item.orderUnitName).toLowerCase() === countUnit(item).toLowerCase();
  if (!unitIsOrder) return '';
  const each = countUnitPrice / n;
  return (each < 0.1 ? '$' + each.toFixed(3) : money(each)) + ' per ' + String(base).toLowerCase();
}

/* ---------- vendors (ported from Inventory 3.0.1) ---------- */
function vendorFromSrc(src) {
  if (!src) return null; src = String(src);
  if (src.includes('americanortho')) return 'American Orthodontics';
  if (src.includes('sunsurgical')) return 'SunSurgical';
  if (src.includes('patterson')) return 'Patterson Dental';
  if (src.includes('reliance')) return 'Reliance Orthodontics';
  if (src.includes('ormco')) return 'Ormco';
  if (src.includes('henryschein')) return 'Henry Schein';
  if (src.includes('komet')) return 'Komet USA';
  if (src.includes('zendura')) return 'ZenduraDental';
  if (src.includes('amazon')) return 'Amazon Business';
  return null;
}
/* Vendor-name similarity that understands abbreviations: "AO" matches "American Orthodontics", "HSD" matches "Henry Schein Dental",
   plus containment and a shared real word ("schein"). */
const VENDOR_STOP_WORDS = { the: 1, inc: 1, llc: 1, co: 1, corp: 1, company: 1, usa: 1, dental: 1, ortho: 1, orthodontic: 1, orthodontics: 1, supply: 1, supplies: 1, products: 1, lab: 1, labs: 1 };
function vendorNamesSimilar(a, b) {
  const an = String(a || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const bn = String(b || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!an || !bn) return false;
  if (an === bn || an.indexOf(bn) !== -1 || bn.indexOf(an) !== -1) return true;
  if (an.replace(/ /g, '') === bn.replace(/ /g, '')) return true;
  const aw = an.split(' '), bw = bn.split(' ');
  const awSig = aw.filter(w => w.length > 2 && !VENDOR_STOP_WORDS[w]);
  const bwSig = bw.filter(w => w.length > 2 && !VENDOR_STOP_WORDS[w]);
  if (awSig.some(w => bwSig.indexOf(w) !== -1)) return true;
  const ai = aw.map(w => w.charAt(0)).join(''), bi = bw.map(w => w.charAt(0)).join('');
  const aCompact = an.replace(/ /g, ''), bCompact = bn.replace(/ /g, '');
  if (aCompact.length >= 2 && aCompact.length <= 4 && (aCompact === bi || bi.indexOf(aCompact) === 0)) return true;
  if (bCompact.length >= 2 && bCompact.length <= 4 && (bCompact === ai || ai.indexOf(bCompact) === 0)) return true;
  return false;
}
/* a vendor-specific search page for a source (its src is the vendor's site or product page) */
function vendorSearchUrl(src, item) {
  if (!src || !src.src) return null;
  const url = String(src.src), sku = src.sku || (item && item.sku) || '', q = encodeURIComponent(sku || (item && item.name) || '');
  if (url.includes('amazon.com/dp/')) return url;
  if (url.includes('amazon.com')) return 'https://www.amazon.com/s?k=' + q;
  if (url.includes('americanortho.com')) return 'https://shop.americanortho.com/search?q=' + q;
  if (url.includes('pattersondental.com')) return 'https://www.pattersondental.com/Search?q=' + q;
  if (url.includes('kometusa.com')) return 'https://www.kometusa.com/System-pages/Search-Results?searchtext=' + q + '&searchmode=anyword';
  if (url.includes('net32.com')) return 'https://www.net32.com/ec/search?q=' + q;
  if (url.includes('henryschein.com')) return 'https://www.henryschein.com/us-en/Search?searchkeyWord=' + q;
  if (url.includes('relianceorthodontics.com')) return 'https://www.relianceorthodontics.com/?s=' + q;
  if (url.includes('ormco.com')) return 'https://ormco.com/en-us/search?q=' + q;
  if (url.includes('sunsurgical.com')) return 'https://www.google.com/search?q=site%3Asunsurgical.com+' + q;
  if (url.includes('zenduradental.com')) return 'https://zenduradental.com/search?q=' + q;
  try { return 'https://www.google.com/search?q=site%3A' + new URL(url).hostname + '+' + q; } catch (e) { return url; }
}
/* a vendor's logo: the embedded one, else its site's icon from Google's favicon service */
function vendorLogoUrl(v) {
  if (!v) return null;
  if (v.id && typeof VENDOR_LOGOS !== 'undefined' && VENDOR_LOGOS[v.id]) return VENDOR_LOGOS[v.id];
  let host = null;
  if (v.portal) { try { host = new URL(v.portal).hostname; } catch (e) { } }
  if (!host) { const em = v.repEmail || v.email || ''; if (em.indexOf('@') > -1) host = em.split('@')[1]; }
  if (!host) return null;
  host = host.replace(/^(www|shop|store|order|portal)\./, '');
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=128';
}
