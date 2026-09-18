"""Read-only offline audit of retained NOAA research samples; standard library only.
Run from repository root: python3 docs/research/history/analyze-samples.py
Writes summary evidence only beside this file; performs no network requests.
"""
import calendar, collections, csv, datetime, json, pathlib
P = pathlib.Path(__file__).parent
hourly = {}
for f in sorted(P.glob('*-2020-head.psv')):
    if f.stat().st_size < 500:
        continue  # retained HTTP error body, not observations
    # Byte-range samples end mid-row: always discard final partial line.
    lines = f.read_text().splitlines()[:-1]
    rows = list(csv.DictReader(lines, delimiter='|'))
    assert all(None not in r and None not in r.values() for r in rows)
    result = {'rows': len(rows), 'first': rows[0]['DATE'], 'last': rows[-1]['DATE'], 'variables': {}}
    for v in ['temperature','dew_point_temperature','station_level_pressure','wind_speed','relative_humidity','wet_bulb_temperature','precipitation']:
        rr = [r for r in rows if r[v].strip() and r[v].strip() not in ['-9999','-9999.0','-999.9']]
        result['variables'][v] = {'nonempty': len(rr)}
        for label, suffix in [('quality','Quality_Code'),('measurement','Measurement_Code'),('sources','Source_Code')]:
            result['variables'][v][label] = dict(collections.Counter(r[v+'_'+suffix] for r in rr))
    result['example_rows'] = rows[:2]
    hourly[f.stem] = result
(P/'hourly-summary.json').write_text(json.dumps(hourly, indent=2)+'\n')
daily = {}
# Freeze the original audit cohort; follow-up stations use analyze-daily-v2.py.
for f in sorted(P/(s+'.dly') for s in ['USC00427516','USW00003184','USW00012854','USW00026451','USW00022521']):
    rows = []
    for line in f.read_text().splitlines():
        assert len(line) == 269, (f, len(line))
        year, month, variable = int(line[11:15]), int(line[15:17]), line[17:21]
        for day in range(1, calendar.monthrange(year,month)[1]+1):
            i = 21+(day-1)*8
            rows.append({'date':f'{year:04}-{month:02}-{day:02}','variable':variable,'value':int(line[i:i+5]),'mflag':line[i+5],'qflag':line[i+6],'sflag':line[i+7]})
    present = [r for r in rows if r['value'] != -9999]
    result = {'first_nonmissing_date':min(r['date'] for r in present),'last_nonmissing_date':max(r['date'] for r in present),'periods':{},'flagged_examples':[r for r in present if r['qflag'] != ' '][:8]}
    for label,begin,end in [('baseline','1991-01-01','2020-12-31'),('recent','2016-01-01','2025-12-31'),('sample_july_2020','2020-07-01','2020-07-31')]:
        expected = (datetime.date.fromisoformat(end)-datetime.date.fromisoformat(begin)).days+1
        stats = {}
        for v in ['TMAX','TMIN','PRCP','AWND','ADPT','RHAV','AWBT']:
            rr = [r for r in rows if begin<=r['date']<=end and r['variable']==v and r['value']!=-9999]
            valid = [r for r in rr if r['qflag']==' ']
            assert len({r['date'] for r in valid}) == len(valid)
            assert len(valid) <= expected
            stats[v] = {'expected_days':expected,'present_days':len(rr),'unflagged_days':len(valid),'qflag_counts':dict(collections.Counter(r['qflag'] for r in rr)),'mflag_counts':dict(collections.Counter(r['mflag'] for r in rr))}
        result['periods'][label] = stats
    result['sample_july15_2020'] = [r for r in rows if r['date']=='2020-07-15']
    daily[f.stem] = result
(P/'daily-summary.json').write_text(json.dumps(daily,indent=2)+'\n')
print('Verified fixed-width daily parsing, valid calendar days, unique daily counts, and complete PSV rows for',len(daily),'daily /',len(hourly),'hourly stations.')
