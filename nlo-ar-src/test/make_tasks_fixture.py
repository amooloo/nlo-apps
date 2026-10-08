"""A made-up Edge "Upcoming and Overdue Tasks" export for the tests, laid out like the real one (Edge v8, Oct 2026): the title with
the run time on the right, "Operator", the headings (Task, Due Date, Category, Creator, Description), each operator's name on a
line of its own above their tasks, a Description that is a running log (line breaks in it), and the "Edge v…" line at the end.
The task titles are written the way the FC writes them ("LETTERS - Jane Doe LETTER RETURNED", "AA MADE - …", "PT - …",
"START LETTERS JANE DOE", "INS MetLife Questionnaire Jane Doe", a name run into the next word, a name a letter off …), about the
made-up accounts of the made-up A/R export (test/fixtures/expected.json), so the two can be matched. Every name is invented.
Run: python3 test/make_tasks_fixture.py  → test/fixtures/edge-tasks.xls, edge-tasks.tsv, tasks-expected.json (needs xlwt)"""
import datetime, json, os
import xlwt

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'fixtures')
RUN = datetime.datetime(2026, 10, 8, 6, 45, 37)

def accounts():
    rows = json.load(open(os.path.join(OUT, 'expected.json')))['full']['rows']
    keep = lambda r: (r['due'] or 0) > 0 or (r['bal'] or 0) < 0  # past due or in credit: on the A/R lists
    pt = [r for r in rows if not r['rp'].upper().startswith('INS:') and keep(r)]
    ins = [r for r in rows if r['rp'].upper().startswith('INS:') and keep(r)]
    return pt, ins

def swap2(s):  # a typo: two letters swapped in the middle
    return s[:2] + s[3] + s[2] + s[4:] if len(s) > 4 else s

def build():
    pt, ins = accounts()
    first = lambda r: r['patient'].split(' ')[0]
    last = lambda r: r['patient'].split(' ')[-1]
    rp_plain = lambda r: r['rp'].replace('INS: ', '').replace('Mr. ', '').replace('Mrs. ', '')
    d = lambda y, m, dd: datetime.date(y, m, dd)
    # a responsible party with only one account on the report, whose name isn't a patient's too
    names = lambda r: ' '.join(r['patient'].split())
    allrp = [rp_plain(r) for r in pt + ins]
    solo = next(r for r in pt[11:] if allrp.count(rp_plain(r)) == 1 and rp_plain(r) not in [names(x) for x in pt + ins])
    log = 'Reminder texted to the parent.\r\nSecond reminder texted; parent asked for a call on Friday.\r\n\r\n09/14/2026 letter mailed and emailed.'
    # (operator, title, due, description, what it should match: ('exact'|'close'|'none'|'two', patient, is insurance))
    T = [
        ('Riley', 'LETTERS - %s LETTER RETURNED' % pt[0]['patient'], d(2026, 9, 3), log, ('exact', pt[0]['patient'], False)),
        ('Riley', 'AA MADE - %s' % pt[1]['patient'], d(2026, 9, 4), 'AA MADE: drafts on the 4th of each month.', ('exact', pt[1]['patient'], False)),
        ('Riley', 'AA MADE - %s ' % pt[2]['patient'], d(2026, 8, 24), '10/01 parent paid $75.00 on the past due.\r\nAA MADE: $40.00 every other Friday', ('exact', pt[2]['patient'], False)),
        ('Riley', 'PT - %s' % pt[3]['patient'], d(2026, 11, 12), 'Call about the balance.', ('exact', pt[3]['patient'], False)),
        ('Riley', 'START LETTERS %s' % pt[4]['patient'].upper(), d(2026, 8, 28), 'Start the letters.', ('exact', pt[4]['patient'], False)),
        ('Riley', 'PT - %s Q %s' % (first(pt[5]), last(pt[5])), d(2026, 8, 20), 'Middle initial in the task.', ('exact', pt[5]['patient'], False)),
        ('Riley', 'PT INS PAID SUBSCRIBER %s%s' % (first(pt[6]), last(pt[6])), d(2026, 9, 28), 'Insurance paid the subscriber.', ('exact', pt[6]['patient'], False)),
        ('Riley', 'PT - %s %s' % (swap2(first(pt[7])), last(pt[7])), d(2026, 8, 19), 'First name a letter off.', ('close', pt[7]['patient'], False)),
        ('Riley', 'LETTERS - %s' % rp_plain(pt[8]), d(2026, 8, 27), 'Named after a parent with three children on the report.', ('two', '', False)),
        ('Riley', 'AA MADE - %s' % rp_plain(solo), d(2026, 9, 14), 'Named after the responsible party.', ('close', solo['patient'], False)),
        ('Riley', 'PT - Imaginary Nobodyton', d(2026, 8, 13), 'Not on the A/R report.', ('none', '', False)),
        ('Riley', 'INS MetLife Questionnaire %s' % ins[0]['patient'], d(2026, 7, 9), 'Questionnaire sent.', ('exact', ins[0]['patient'], True)),
        ('Riley', 'INS GEHA %s WRITE OFF' % ins[1]['patient'], d(2026, 3, 11), 'Write off the balance.', ('exact', ins[1]['patient'], True)),
        ('Riley', 'INS MetLife %sWaiting for denial' % ins[2]['patient'], d(2026, 7, 2), 'Waiting for the denial.', ('exact', ins[2]['patient'], True)),
        ('Riley', 'INS Ameritas %s %s AS BILLED CLAIM' % (first(ins[3]), swap2(last(ins[3]))), d(2026, 7, 1), 'Last name a letter off.', ('close', ins[3]['patient'], True)),
        ('Riley', 'INS TERMINATED %s' % pt[9]['patient'], d(2026, 6, 22), 'Insurance terminated — the patient account.', ('close', pt[9]['patient'], False)),
        ('Riley', 'LETTERS - %s' % pt[0]['patient'], d(2026, 10, 30), 'A second task for the same account.', ('exact', pt[0]['patient'], False)),
        ('Jamie', 'PT - %s' % pt[10]['patient'], d(2026, 10, 20), '', ('exact', pt[10]['patient'], False)),
    ]
    head = [(0, 'Task'), (3, 'Due Date'), (5, 'Category'), (6, 'Creator'), (7, 'Description')]
    rows = [[(0, 'Upcoming and Overdue Tasks', 's'), (9, RUN, 'dt')], [], [], [], [], [], [(0, 'Operator', 's')], [(c, t, 's') for c, t in head]]
    expected, op = [], None
    for o, title, due, desc, want in T:
        if o != op:
            rows.append([(0, o, 's')]); op = o
        r = [(0, title, 's'), (3, datetime.datetime.combine(due, datetime.time(8, 0)), 'dt'), (6, o, 's')]
        if desc: r.append((7, desc, 's'))
        rows.append(r)
        txt = desc.replace('\r\n', '\n').strip()
        expected.append(dict(op=o, title=' '.join(title.split()), due=due.isoformat(), cat='', creator=o, desc=txt, want=dict(how=want[0], patient=want[1], ins=want[2])))
    rows.append([]); rows.append([(0, 'Edge v8.0.22.1003', 's')])
    return rows, expected

def write_xls(path, rows):
    wb = xlwt.Workbook(encoding='utf-8')
    ws = wb.add_sheet('Sheet1'); wb.add_sheet('Sheet2'); wb.add_sheet('Sheet3')
    dt = xlwt.easyxf(num_format_str='M/D/YYYY h:mm AM/PM'); wrap = xlwt.easyxf('align: wrap on')
    for ri, row in enumerate(rows):
        for c, v, k in row:
            if k == 'dt': ws.write(ri, c, v, dt)
            elif c == 0 and ri > 7: ws.write_merge(ri, ri, 0, 2, v)  # Edge merges the task title over three columns
            elif c == 7: ws.write(ri, c, v, wrap)
            else: ws.write(ri, c, v)
    wb.save(path)

def write_tsv(path, rows):
    lines = []
    for row in rows:
        cells = {}
        for c, v, k in row:
            cells[c] = v.strftime('%-m/%-d/%Y %-I:%M %p') if k == 'dt' else ('"' + v.replace('"', '""') + '"' if '\n' in v or '\t' in v else v)
        n = max(cells) + 1 if cells else 0
        lines.append('\t'.join(cells.get(i, '') for i in range(n)))
    open(path, 'w').write('\r\n'.join(lines) + '\r\n')

if __name__ == '__main__':
    rows, expected = build()
    write_xls(os.path.join(OUT, 'edge-tasks.xls'), rows)
    write_tsv(os.path.join(OUT, 'edge-tasks.tsv'), rows)
    json.dump(expected, open(os.path.join(OUT, 'tasks-expected.json'), 'w'), indent=1, ensure_ascii=False)
    print('wrote', len(expected), 'tasks')
