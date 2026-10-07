"""A made-up Edge "Insurance Accounts Receivable Aging" export for the tests, laid out like the real one (Edge v8, Oct 2026):
the title twice (the run time on the first line), the date line, options, subgroup, the A/R Aging's headings plus "ID" (and
Edge's own spelling "Recieved"), then the insurance accounts grouped by carrier — each group opened by a line
"Carrier name   -   phone" (padded to a column, or short; just the name when Edge has no phone) and closed by
"(N Patients)" — then "(N Total Patients)" with the totals and the "Edge v…" line. Some cells merged, as Edge does.
The accounts are the insurance accounts of the made-up A/R export (test/fixtures/expected.json, so the two can be matched),
a few more that aren't past due, and one patient with a second contract under the same policyholder at another carrier.
Every name, number and carrier is invented.
Run: python3 test/make_ins_fixture.py  → test/fixtures/ins-aging.xls, ins-aging.tsv, ins-expected.json (needs xlwt)"""
import datetime, json, os
import xlwt

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'fixtures')
AS_OF = datetime.date(2026, 10, 5)
RUN = datetime.datetime(2026, 10, 5, 14, 21, 7)
HEAD = [(0, 'Patient'), (1, 'ID'), (3, 'Sts'), (4, 'Responsible Party'), (5, 'Home  Ph'), (6, 'Amt Due'), (7, '0-30'), (8, '31-60'),
        (9, '61-90'), (10, '91+'), (12, 'Days'), (14, 'Balance'), (16, 'Last Amt'), (17, 'Recieved')]
# (the heading line as Edge prints it, the carrier's name, its phone) — padded and short forms, a name with " - " in it,
# a malformed phone, one carrier twice (once without a phone), one with no phone at all, an old one Edge keeps as "zz OLD"
CARRIERS = [
    ('Bayou Dental Mutual'.ljust(53) + '-   (800) 555-0142            ', 'Bayou Dental Mutual', '(800) 555-0142'),
    ('Gator Benefits - FL'.ljust(53) + '-   1-800-555-0177', 'Gator Benefits - FL', '1-800-555-0177'),
    ('Heron Life Ins.', 'Heron Life Ins.', ''),
    ('Manatee Concordia (Tricare)   -   (844)555-0199', 'Manatee Concordia (Tricare)', '(844)555-0199'),
    ('Osprey Dental Plan'.ljust(53) + '-   (800 555-0123       ', 'Osprey Dental Plan', '(800 555-0123'),
    ('Pelican Dental', 'Pelican Dental', ''),
    ('Pelican Dental    -   8005550188', 'Pelican Dental', '8005550188'),
    ('zz OLD - Heron Life    -   8005550100', 'zz OLD - Heron Life', '8005550100'),
]

def r2(x): return round(x + 1e-9, 2)

def accounts():
    exp = json.load(open(os.path.join(OUT, 'expected.json')))['full']['rows']
    ins = [dict(r) for r in exp if r['rp'].upper().startswith('INS:')]
    out = []
    for i, r in enumerate(ins):
        r['acct'] = '99-%04d' % (100 + i)  # 99-: a prefix Edge doesn't use
        r['carrier'] = i % len(CARRIERS)
        out.append(r)
    # four more insurance accounts that aren't past due (so not on the A/R lists)
    for j, (pat, holder) in enumerate([('Wren Sampleton', 'Lee Sampleton'), ('Kit Demoley', 'Robin Demoley'), ('Ash Mockwell', 'Pat Mockwell'), ('Bay Fakely', 'Chris Fakely')]):
        out.append(dict(patient=pat, acct='99-%04d' % (800 + j), sts='A-Comp Bra', rp='INS: ' + holder, home='(352) 555-02%02d' % j, work='', due=0.0, b0=0.0, b30=0.0, b60=0.0, b90=0.0,
                        days=0, bal=r2(600 + 75 * j), lastAmt=r2(150 + 25 * j), recv=(AS_OF - datetime.timedelta(days=20 + j)).isoformat(), note='', carrier=(j * 3) % len(CARRIERS)))
    # the first past-due insurance account also has a second contract (same policyholder) at another carrier, paid up to date
    first = next(r for r in out if r['due'] > 0)
    second = dict(first, acct='99-%04d' % 900, due=0.0, b0=0.0, b30=0.0, b60=0.0, b90=0.0, days=0, bal=640.0, lastAmt=160.0, recv=(AS_OF - datetime.timedelta(days=12)).isoformat(),
                  carrier=(first['carrier'] + 1) % len(CARRIERS))
    out.append(second)
    return out, first['patient']

def build():
    accts, twice = accounts()
    rows = [[(0, 'Insurance Accounts Receivable Aging', 's'), (13, RUN, 'dt')], [(0, 'Insurance Accounts Receivable Aging', 's')],
            [(0, 'Monday, October 5, 2026  Office: All,  Doctor: All', 's')], [(0, 'Exclude Zero Dollar Balances', 's')], [(0, 'Subgroup: None', 's')], [], [],
            [(c, t, 's') for c, t in HEAD]]
    expected, groups = [], []
    for ci, (line, name, phone) in enumerate(CARRIERS):
        mine = sorted([a for a in accts if a['carrier'] == ci], key=lambda a: (a['patient'].split(' ')[-1], a['patient']))
        rows.append([(0, line, 's')])
        for a in mine:
            r = [(0, a['patient'], 's'), (1, a['acct'], 's'), (3, a['sts'], 's'), (4, a['rp'], 's')]
            if a['home']: r.append((5, a['home'], 's'))
            r += [(6, a['due'], 'n'), (7, a['b0'], 'n'), (8, a['b30'], 'n'), (9, a['b60'], 'n'), (10, a['b90'], 'n'), (12, str(a['days'] if a['days'] is not None else 0), 's'), (14, a['bal'], 'n')]
            if a['lastAmt'] is not None: r.append((16, a['lastAmt'], 'n'))
            if a['recv']: r.append((17, datetime.date.fromisoformat(a['recv']), 'd'))
            rows.append(r)
            expected.append(dict(patient=a['patient'], acct=a['acct'], sts=a['sts'], rp=a['rp'], home=a['home'], due=a['due'], b0=a['b0'], b30=a['b30'], b60=a['b60'], b90=a['b90'],
                                 days=a['days'] if a['days'] is not None else 0, bal=a['bal'], lastAmt=a['lastAmt'], recv=a['recv'] or '', carrier=name, cphone=phone))
        rows.append([(0, '(%d Patients)' % len(mine), 's')])
        groups.append(dict(name=name, phone=phone, n=len(mine)))
    tot = {k: r2(sum(e[k] for e in expected)) for k in ['due', 'b0', 'b30', 'b60', 'b90', 'bal']}
    rows.append([(0, '(%d Total Patients)' % len(expected), 's'), (6, tot['due'], 'n'), (7, tot['b0'], 'n'), (8, tot['b30'], 'n'), (9, tot['b60'], 'n'), (10, tot['b90'], 'n'), (14, tot['bal'], 'n')])
    rows.append([]); rows.append([(0, 'Edge v8.0.22.1003', 's')])
    return rows, expected, groups, tot, twice

def merges_for(ri, row):
    cols = {c for c, _, _ in row}
    return [(ri, ri, c0, c1) for c0, c1 in [(1, 2), (10, 11), (12, 13), (14, 15)] if c0 in cols and ri % 3 == 0 and len(row) > 4]

def write_xls(path, rows):
    wb = xlwt.Workbook(encoding='utf-8')
    ws = wb.add_sheet('Sheet1'); wb.add_sheet('Sheet2'); wb.add_sheet('Sheet3')
    money = xlwt.easyxf(num_format_str='#,##0.00'); date = xlwt.easyxf(num_format_str='M/D/YYYY'); dt = xlwt.easyxf(num_format_str='M/D/YYYY h:mm AM/PM')
    for ri, row in enumerate(rows):
        merged = merges_for(ri, row) if ri > 7 else []
        mcols = {m[2]: m for m in merged}
        for c, v, k in row:
            st = money if k == 'n' else date if k == 'd' else dt if k == 'dt' else xlwt.Style.default_style
            if c in mcols: m = mcols[c]; ws.write_merge(m[0], m[1], m[2], m[3], v, st)
            else: ws.write(ri, c, v, st)
    wb.save(path)

def write_tsv(path, rows):
    # what Excel puts on the clipboard: tab-separated, dates and amounts as shown
    lines = []
    for row in rows:
        cells = {}
        for c, v, k in row:
            cells[c] = v.strftime('%-m/%-d/%Y %-I:%M %p') if k == 'dt' else v.strftime('%-m/%-d/%Y') if k == 'd' else ('{:,.2f}'.format(v) if v >= 0 else '-{:,.2f}'.format(-v)) if k == 'n' else str(v)
        n = max(cells) + 1 if cells else 0
        lines.append('\t'.join(cells.get(i, '') for i in range(n)))
    open(path, 'w').write('\r\n'.join(lines) + '\r\n')

if __name__ == '__main__':
    rows, expected, groups, tot, twice = build()
    write_xls(os.path.join(OUT, 'ins-aging.xls'), rows)
    write_tsv(os.path.join(OUT, 'ins-aging.tsv'), rows)
    json.dump(dict(asOf=AS_OF.isoformat(), rows=expected, groups=groups, total=dict(tot, n=len(expected)), twice=twice), open(os.path.join(OUT, 'ins-expected.json'), 'w'), indent=1, ensure_ascii=False)
    print('wrote', len(expected), 'accounts in', len(groups), 'carrier groups')
