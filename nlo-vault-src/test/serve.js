// Serves a built vault folder with the same response headers Firebase Hosting will send (CSP, no framing, …).
import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
export function serve(dir, headersFile, port) {
  const headers = JSON.parse(readFileSync(headersFile, 'utf8'));
  const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const f = join(dir, p.replace(/\.\.+/g, ''));
    if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
    for (const h of headers) res.setHeader(h.key, h.value);
    res.setHeader('Content-Type', types[extname(f)] || 'application/octet-stream');
    res.end(readFileSync(f));
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
if (process.argv[1] && process.argv[1].endsWith('serve.js')) {
  await serve(process.argv[2] || 'dist-test/public', process.argv[3] || 'dist-test/headers.json', +(process.argv[4] || 8770));
  console.log('serving on http://127.0.0.1:' + (process.argv[4] || 8770));
}
