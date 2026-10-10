// The office check as Dr. A copies it from the page, run under Node for the end-to-end test (Cloudflare stand-in): each
// request's address is the one the test gives it (X-Test-IP), so one browser can be "at the office" and another "at home".
//   node test/worker_server.mjs <the copied code, as a .mjs file> <port>
import http from 'http';
import { pathToFileURL } from 'url';

const [file, port] = process.argv.slice(2);
const W = (await import(pathToFileURL(file).href)).default;
http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const h = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !/^(host|connection|content-length|transfer-encoding)$/i.test(k)) h.set(k, v);
    const ip = h.get('x-test-ip') || '203.0.113.10', org = h.get('x-test-org') || 'Test Internet';
    h.delete('x-test-ip'); h.delete('x-test-org'); h.set('CF-Connecting-IP', ip);
    const r = new Request('https://nlo-office-check.e2e.workers.dev' + req.url, { method: req.method, headers: h, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    Object.defineProperty(r, 'cf', { value: { asOrganization: org, city: 'Gainesville', region: 'Florida' } });
    const out = await W.fetch(r);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
}).listen(Number(port), '127.0.0.1', () => console.log('office check listening on ' + port));
