/* NLO Office Calendar — phone feed service (a Cloudflare Worker). Amir, 31 Oct 2026.
   The Office Calendar keeps a copy of itself as a calendar file (.ics) in the NLO Cases database, under a long random
   address (calFeed/<id>; the database lets anyone fetch one by its exact address, nobody list them). Google Calendar and
   the iPhone Calendar need a plain web address that answers with that file, so this worker passes it through:
     https://<this worker>/<id>.ics  →  the file
   It keeps nothing, needs no keys or settings, and reads nothing else. Deploy: Cloudflare → Workers & Pages → Create →
   Worker → paste this file → Deploy; then paste the worker's address into the calendar (Settings → Phone sync). */
const CORS = { 'access-control-allow-origin': '*' };
const DOC = id => 'https://firestore.googleapis.com/v1/projects/nlo-cases/databases/(default)/documents/calFeed/' + id;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: CORS });
    const m = /^\/([A-Za-z0-9]{32,64})\.ics$/.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404, headers: CORS });
    const r = await fetch(DOC(m[1]), { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return new Response('Not found', { status: 404, headers: CORS });
    const j = await r.json().catch(() => null);
    const ics = j && j.fields && j.fields.ics && j.fields.ics.stringValue;
    if (!ics || !ics.startsWith('BEGIN:VCALENDAR')) return new Response('Not found', { status: 404, headers: CORS });
    return new Response(request.method === 'HEAD' ? null : ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="nlo-office.ics"',
        'cache-control': 'public, max-age=900',
        'x-robots-tag': 'noindex',
        'access-control-allow-origin': '*'   /* (so the calendar's "Test the address" button can read it) */
      }
    });
  }
};
