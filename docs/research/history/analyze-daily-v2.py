"""Offline research only: versioned daily coverage; never changes v1 summaries.
Run: python3 docs/research/history/analyze-daily-v2.py
"""
import calendar, collections, datetime as dt, hashlib, json, pathlib

P = pathlib.Path(__file__).parent
V = ('TMAX', 'TMIN', 'PRCP')
OUT = {}

def counts(days, records):
    out = {'expected_days': len(days), 'variables': {}}
    sets = []
    for v in V:
        rr = [records[(d, v)] for d in days if (d, v) in records and records[(d, v)][0] != -9999]
        accepted = {d for d in days if (d, v) in records and records[(d, v)][0] != -9999 and records[(d, v)][2] == ' '}
        sets.append(accepted)
        out['variables'][v] = {'present': len(rr), 'accepted': len(accepted), 'rejected_qc': sum(r[2] != ' ' for r in rr), 'missing': len(days)-len(rr), 'qflags': dict(collections.Counter(r[2] for r in rr)), 'mflags': dict(collections.Counter(r[1] for r in rr)), 'sflags': dict(collections.Counter(r[3] for r in rr))}
        c = out['variables'][v]
        assert c['accepted'] + c['rejected_qc'] + c['missing'] == len(days)
    joint = set.intersection(*sets)
    run = longest = 0
    gap_end = None
    for d in days:
        run = 0 if d in joint else run + 1
        if run > longest:
            longest, gap_end = run, d
    out.update(joint_accepted=len(joint), joint_not_accepted=len(days)-len(joint), longest_joint_gap_days=longest)
    out['longest_joint_gap'] = None if gap_end is None else {'begin': str(gap_end-dt.timedelta(days=longest-1)), 'end': str(gap_end)}
    return out

for f in sorted(P.glob('*.dly')):
    records = {}
    for line in f.read_text().splitlines():
        assert len(line) == 269 and line[:11] == f.stem
        y, m, v = int(line[11:15]), int(line[15:17]), line[17:21]
        if v not in V:
            continue
        for d in range(1, calendar.monthrange(y, m)[1]+1):
            date = dt.date(y, m, d)
            if not 1991 <= y <= 2025:
                continue
            i = 21+(d-1)*8
            key = (date, v)
            assert key not in records, (f, key)
            records[key] = (int(line[i:i+5]), line[i+5], line[i+6], line[i+7])
    result = {'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), 'periods': {}}
    for label, first, last in [('baseline', 1991, 2020), ('recent', 2016, 2025)]:
        days = [dt.date(y, m, d) for y in range(first, last+1) for m in range(1, 13) for d in range(1, calendar.monthrange(y, m)[1]+1)]
        total = counts(days, records)
        years = {str(y): counts([d for d in days if d.year == y], records) for y in range(first, last+1)}
        months = {f'{y}-{m:02}': counts([d for d in days if d.year == y and d.month == m], records) for y in range(first, last+1) for m in range(1, 13)}
        for group in (years, months):
            assert sum(c['expected_days'] for c in group.values()) == len(days)
            assert sum(c['joint_accepted'] for c in group.values()) == total['joint_accepted']
            for v in V:
                for k in ('accepted', 'present', 'missing', 'rejected_qc'):
                    assert sum(c['variables'][v][k] for c in group.values()) == total['variables'][v][k]
        result['periods'][label] = {'total': total, 'years': years, 'months': months}
    OUT[f.stem] = result

old = json.loads((P/'daily-summary.json').read_text())
for station, prior in old.items():
    for period in ('baseline', 'recent'):
        for v in V:
            assert OUT[station]['periods'][period]['total']['variables'][v]['accepted'] == prior['periods'][period][v]['unflagged_days']
(P/'daily-coverage-v2.json').write_text(json.dumps(OUT, indent=2)+'\n')
print('Validated', len(OUT), 'stations; calendar/duplicate/partition assertions and original five-station accepted counts agree.')
for s, r in OUT.items():
    print(s, {p: {'accepted': [x['total']['variables'][v]['accepted'] for v in V], 'joint': x['total']['joint_accepted'], 'gap': x['total']['longest_joint_gap_days'], 'full_years': sum(y['joint_accepted']==y['expected_days'] for y in x['years'].values())} for p, x in r['periods'].items()})
