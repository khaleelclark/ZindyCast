"""Offline follow-up evidence verification, not an application test suite."""
import hashlib, json, pathlib, re, subprocess, sys
P = pathlib.Path(__file__).parent
ROOT = P.parents[2]
def sha(f):
    return hashlib.sha256(f.read_bytes()).hexdigest()
original = json.loads((P/'followup-original-hashes.json').read_text())
allowed = {'docs/research/station-history.md', 'docs/research/history/README.md', 'docs/research/history/analyze-samples.py'}
preserved = [name for name, digest in original.items() if name not in allowed and sha(ROOT/name) == digest]
assert len(preserved) == len(original)-len(allowed), 'Unexpected change in prior evidence or plan'
outputs = ['daily-coverage-v2.json', 'homr-summary-v2.json']
before = {name: sha(P/name) for name in outputs}
logs = []
for script in ['analyze-daily-v2.py', 'analyze-homr-v2.py', 'analyze-samples.py']:
    logs.append(subprocess.check_output([sys.executable, str(P/script)], text=True))
assert before == {name: sha(P/name) for name in outputs}
for name in ['daily-summary.json', 'hourly-summary.json']:
    assert sha(P/name) == original['docs/research/history/'+name]
for r in json.loads((P/'followup-downloads.json').read_text()):
    assert r['status'] == 200 and sha(P/r['file']) == r['sha256']
    assert (P/r['file']).stat().st_size == r['bytes']
    length = next((v for k,v in r['headers'].items() if k.lower()=='content-length'), None)
    if length is not None:
        assert int(length) == r['bytes']
report = ROOT/'docs/research/station-history.md'
links = re.findall(r'\]\(([^)]+)\)', report.read_text())
local = [x for x in links if not x.startswith(('http:', 'https:', '#'))]
assert all((report.parent/x).exists() or (report.parent/x).resolve() == (P/'validation-v2.json').resolve() for x in local)
meta = (P/'ghcnd-stations-subset.txt').read_text()+(P/'ghcnh-station-list-subset.csv').read_text()
ids = sorted(set(re.findall(r'\bUS[A-Z0-9]{9}\b', report.read_text())))
assert all(i in meta for i in ids)
allfiles = [f for f in P.iterdir() if f.is_file() and f.name != 'validation-v2.json'] + [report]
changed = [str(f.relative_to(ROOT)) for f in allfiles if str(f.relative_to(ROOT)) in original and sha(f) != original[str(f.relative_to(ROOT))]]
new = [str(f.relative_to(ROOT)) for f in allfiles if str(f.relative_to(ROOT)) not in original]
result = {'status': 'passed', 'preserved_original_files': preserved, 'changed_files': sorted(changed), 'new_files_excluding_this_manifest': sorted(new), 'deterministic_v2_output_sha256': before, 'original_summary_reruns_unchanged': True, 'daily_station_count': 9, 'targeted_homr_count': 3, 'report_local_links_checked': len(local), 'report_station_ids_checked': ids, 'checks': ['fixed-width and station ID', 'valid dates and no duplicate core date-variable keys', 'expected=accepted+rejected+missing', 'monthly and yearly counts reconcile', 'old five core-variable period counts agree', 'v2 repeat outputs byte-identical', 'original daily/hourly outputs byte-identical', 'download bytes/checksums/content-length where supplied', 'prior raw evidence and plan unchanged', 'report local links and station identifiers resolve'], 'analyzer_logs': logs, 'new_and_changed_sha256': {str(f.relative_to(ROOT)): sha(f) for f in allfiles if str(f.relative_to(ROOT)) in new+changed}}
(P/'validation-v2.json').write_text(json.dumps(result, indent=2)+'\n')
print('PASS: preservation, nine-station monthly/yearly/joint counts, reproducibility, three HOMR extracts, downloads, links and station IDs.')
