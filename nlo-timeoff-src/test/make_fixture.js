/* Writes the made-up old Time-Off Sheet (demo.js's demoOldSheet, as of Oct 8, 2026) to test/fixtures/old-sheet.json;
   make_fixture.py turns it into the .xlsx Google Sheets would download (and one CSV per tab). Made-up people only.
   Run: node test/make_fixture.js && python3 test/make_fixture.py */
const fs = require('fs'), path = require('path');
const { load } = require('./load');
const A = load(['core.js', 'policy.js', 'demo.js']);
const T = '2026-10-08', x = A.demoOldSheet(T);
const out = { asOf: T, tabs: {} };
x.tabs.forEach((rows, name) => { out.tabs[name] = rows; });
fs.writeFileSync(path.join(__dirname, 'fixtures', 'old-sheet.json'), JSON.stringify(out, null, 1));
console.log('wrote old-sheet.json:', Object.entries(out.tabs).map(([k, v]) => k + ' ' + (v.length - 1)).join(', '));
