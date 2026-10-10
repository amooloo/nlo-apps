/* A stand-in for ntfy (phone push) for the tests: records each push it gets, one JSON line per push, in LOG.
     node test/fake_ntfy.js <port> <log file> [fail flag file: while it exists, every push gets a 500] */
const http = require('http'), fs = require('fs');
const [port, log, flag] = process.argv.slice(2);
http.createServer((q, r) => {
  let b = ''; q.on('data', c => { b += c; });
  q.on('end', () => {
    if (flag && fs.existsSync(flag)) { r.statusCode = 500; r.end('down'); return; }
    fs.appendFileSync(log, b.replace(/\n/g, ' ') + '\n'); r.end('{}');
  });
}).listen(Number(port), '127.0.0.1');
