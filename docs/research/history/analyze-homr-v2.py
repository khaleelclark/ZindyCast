"""Offline extract of bounded HOMR research evidence; raw history is authoritative."""
import json, pathlib
P = pathlib.Path(__file__).parent
out = {}
for f in sorted(P/('homr-'+s+'-v2.json') for s in ['USW00023186', 'USC00427516', 'USC00087982']):
    data = json.loads(f.read_text())['stationCollection']
    assert len(data['stations']) == 1
    s = data['stations'][0]
    out[f.name] = {
        'ncdcStnId': s['ncdcStnId'],
        'identifiers': s['identifiers'],
        'coordinate_epochs': s['location']['latLonPairs'],
        'elevation_epochs': s['location']['elevations'],
        'utc_offsets': s['location']['geoInfo']['utcOffsets'],
        'relocations': s.get('relocations', []),
        'remarks_since_1991': [r for r in s.get('remarks', []) if r['date']['endDate'] >= '1991'],
        'elements_field_present': 'elements' in s,
        'core_element_epochs_since_1991': [e for e in s.get('elements', []) if e['element'] in ('TEMP', 'PRECIP') and e['date']['endDate'] >= '1991'],
    }
(P/'homr-summary-v2.json').write_text(json.dumps(out, indent=2)+'\n')
print('Extracted exact history fields from', len(out), 'single-station HOMR responses; no epoch inference.')
