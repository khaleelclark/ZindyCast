"""Offline oracle only: no TS imports. Requires the existing system C compiler.
Writes evidence within docs/verification/heat; executable is temporary.
"""
from pathlib import Path
import subprocess, json, tempfile, hashlib
root = Path(__file__).resolve().parents[3]
ref = root / 'packages/heat/reference'
out = root / 'docs/verification/heat'
cases = []
def add(name, time='2020-07-15T20:00:00Z', lat=33.86, lon=-112.14, t=42, rh=15, p=950, w=2, ghi=900):
    cases.append(dict(id=name, input=dict(time=time, latitude=lat, longitude=lon, temperatureC=t, humidityPercent=rh, surfacePressureHpa=p, wind2mMs=w, ghiWm2=ghi, windAssumption='synthetic explicit 2m wind; no height conversion', radiationAssumption='instantaneous', source='synthetic independent C reference case')))
add('dry')
add('humid', '2020-07-15T18:00:00Z',28.90,-81.26,33,75,1010,2,800)
add('night', '2020-07-16T06:00:00Z',28.90,-81.26,28,90,1010,1,0)
for w in [0,0.12,0.13,0.14]: add('wind-'+str(w), w=w)
for p in [1013.25,850,750]: add('pressure-'+str(p),p=p)
for time,ghi in [('11:00',0),('11:30',20),('12:00',100)]: add('sunrise-'+time,'2020-07-15T'+time+':00Z',28.9,-81.26,27,90,1010,1,ghi)
for time,ghi in [('00:00',100),('01:00',20),('02:00',0)]: add('sunset-'+time,'2020-07-16T'+time+':00Z',28.9,-81.26,29,80,1010,1,ghi)
add('alaska-summer','2020-06-21T22:00:00Z',61.22,-149.90,24,50,1000,2,650)
add('alaska-winter','2020-12-21T22:00:00Z',61.22,-149.90,-10,80,1000,2,0)
add('hawaii','2020-07-15T22:00:00Z',21.31,-157.86,30,65,1012,3,900)
for time in ['1950-01-01T00:00:00Z','1991-06-15T20:00:00Z','2000-02-29T12:00:00Z','2020-12-31T23:59:00Z','2049-12-31T23:59:00Z']:
    add('calendar-'+time,time,ghi=0)
add('saturated',rh=100,t=30)
add('strong-wind',w=50)
add('solar-cap',ghi=2000)
# Extreme but inside engineering envelope: verify reference failure, not fake data.
add('stress',t=60,rh=5,p=200,w=0,ghi=2000)
lines=[]
for c in cases:
    i=c['input']; d=i['time']; date=d[:10].split('-'); hm=d[11:16].split(':')
    lines.append(' '.join([c['id'],*date,*hm,*[str(i[k]) for k in ['latitude','longitude','temperatureC','humidityPercent','surfacePressureHpa','wind2mMs','ghiWm2']]]))
stdin='\n'.join(lines)+'\n'
flags=['-std=gnu89','-O0','-fno-fast-math']
with tempfile.TemporaryDirectory(prefix='zindy-heat-oracle-') as tmp:
    binary=Path(tmp)/'oracle'
    compile_result=subprocess.run(['cc',*flags,str(ref/'oracle.c'),'-lm','-o',str(binary)],capture_output=True,text=True,check=True)
    result=subprocess.run([str(binary)],input=stdin,capture_output=True,text=True,check=True)
rows=result.stdout.splitlines()
assert len(rows)==len(cases)
for c,row in zip(cases,rows):
    ident,status,*values=row.split(); assert ident==c['id']
    c['expected'] = dict(zip(['globeC','naturalWetBulbC','psychrometricWetBulbC','wbgtC','cosineSolarZenith','directFraction','ghiUsedWm2'],map(float,values)))
    c['expected']['originalStatus']=int(status)
out.mkdir(parents=True,exist_ok=True)
(out/'oracle-input.txt').write_text(stdin)
(out/'oracle-output.txt').write_text(result.stdout)
(out/'oracle-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
(out/'oracle-build.json').write_text(json.dumps(dict(compiler=subprocess.check_output(['cc','--version'],text=True).splitlines()[0], flags=flags, sourceSha256=hashlib.sha256((ref/'wbgt-original.c').read_bytes()).hexdigest(), diagnostics=compile_result.stderr),indent=2)+'\n')
print(f'{len(cases)} C oracle cases generated')
