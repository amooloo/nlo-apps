"""A made-up OrthoBanc "Failed Transaction Report" (FailedTransactions.xls) for the tests: the same layout as the real
export (title lines, the two sections — "Action On Your Part Is Needed" (on HOLD) and "No Action Required On Your Part" —
each with its paragraph and the column headings, every failed draft on two lines: status · OB Reference # · Your Acct # ·
patient · responsible · amount, then "Return Reason:" · reason · "MM/DD/YYYY Pmt" · balance), as .xls (BIFF8).
Every name, number and reference is invented.
Run: python3 test/make_ob_fixture.py  → test/fixtures/ob-failed.xls + ob-expected.json  (needs xlwt)"""
import json, os
import xlwt

OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(OUT, exist_ok=True)

# (OB ref, Your Acct #, patient as OrthoBanc writes it, responsible, amount, reason, drafted, how, balance)
HOLD = [
    ('ob04100001', '12345', 'Sample, Avery', 'Sample, Jordan', 165.00, 'Credit Card - Declined Insufficient Funds', '09/28/2026', 'Pmt', 1485.00),
    ('ob04100002', '21-0456', 'De La Cruz, Ana', 'De La Cruz, Maria', 210.50, 'Credit Card - Declined', '10/02/2026', 'Pmt', 2316.00),
]
OTHER = [
    ('ob04100003', '12346     ', "O'Sample, Avery", "O'Sample, Robin", 175.00, 'Credit Card  - Blocked by issuer', '10/02/2026', 'Pmt', 875.00),
    ('ob04100004', '12-3457   ', 'Peña, José', 'Peña, Lucía', 150.00, 'Credit Card - Card Number Error', '10/02/2026', 'OnLine Pmt', 600.00),
    ('ob04100005', '12347', 'Riley Demo', 'Demo, Lee', 199.00, 'Credit Card - Declined Insufficient Funds', '10/02/2026', 'Pmt', 1990.00),
    ('ob04100006', '12348', 'Demo-Ray, Sam', 'Demo-Ray, Pat', 250.00, 'ACH - R01 Insufficient Funds', '10/02/2026', 'Pmt', 3000.00),
    ('ob04100007', '', 'Notreal, Quinn', 'Notreal, Casey', 125.00, 'Credit Card - Declined', '10/02/2026', 'Pmt', 500.00),
    ('ob04100008', '12349', 'Mockley, Dana Lee', 'Mockley, Pat', 99.99, 'Credit Card - Declined Insufficient Funds', '10/02/2026', 'Pmt', 199.98),
]
TOP = 'The following patient(s)/responsible(s) have payment transactions that failed. (Made-up wording for the tests.)'


def write(path):
    wb = xlwt.Workbook(encoding='utf-8'); ws = wb.add_sheet('FailedTransactions')
    money = xlwt.easyxf(num_format_str='0.00')
    put = lambda r, c, v, st=None: ws.write(r, c, v, st) if st else ws.write(r, c, v)
    put(0, 0, 'OrthoBanc'); put(2, 0, 'Failed Transaction Report'); put(3, 0, 'For Next Level Orthodontics '); put(5, 0, 'Monday, October 5, 2026')
    r = 8

    def section(title, rows, r):
        put(r, 1, title); put(r + 2, 1, TOP)
        r += 5
        for c, v in ((1, 'Status *'), (5, 'OB Reference #'), (11, 'Your Acct #'), (14, 'Patient Name'), (19, 'Responsible Name'), (24, 'Amt/Balance')):
            put(r, c, v)
        r += 5
        for ref, acct, pt, rp, amt, why, when, how, bal in rows:
            put(r, 1, 'FAIL'); put(r, 5, ref)
            if acct: put(r, 10, acct)
            put(r, 14, pt); put(r, 19, rp); put(r, 23, amt, money)
            put(r + 2, 2, 'Return Reason: '); put(r + 2, 7, why); put(r + 2, 17, when + ' ' + how + ' ' * 40); put(r + 2, 23, bal, money)
            r += 6
        return r

    r = section('** Action On Your Part Is Needed **', HOLD, r)
    r = section('** No Action Required On Your Part **', OTHER, r + 1)
    wb.save(path)


def first_last(s):
    s = ' '.join(s.split())
    if ',' in s:
        last, first = s.split(',', 1)
        return (first.strip() + ' ' + last.strip()).strip()
    return s


def expected():
    out = []
    for hold, rows in ((True, HOLD), (False, OTHER)):
        for ref, acct, pt, rp, amt, why, when, how, bal in rows:
            m, d, y = when.split('/')
            out.append({'ref': ref, 'status': 'FAIL', 'acct': acct.strip(), 'patient': first_last(pt), 'rp': first_last(rp), 'amt': amt, 'hold': hold,
                         'reason': ' '.join(why.split()), 'date': y + '-' + m + '-' + d, 'how': how, 'bal': bal})
    return {'asOf': '2026-10-05', 'rows': out}


write(os.path.join(OUT, 'ob-failed.xls'))
with open(os.path.join(OUT, 'ob-expected.json'), 'w') as f:
    json.dump(expected(), f, indent=1, ensure_ascii=False)
print('wrote ob-failed.xls and ob-expected.json')
