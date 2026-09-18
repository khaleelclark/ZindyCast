# Single bounded tile request; do not rerun without a new live request budget.
import urllib.request,urllib.error,json,time,datetime,pathlib
p=pathlib.Path(__file__).parent
log=[dict(url='https://api.librewxr.net/public/weather-maps.json',status=403,error='urllib.error.HTTPError: HTTP Error 403: Forbidden',bodyRetained=False,attempts=1)]
url='https://api.librewxr.net/v2/radar/0/512/10/28.858/-81.17/6/1_0.png'
start=time.monotonic()
try:r=urllib.request.urlopen(url,timeout=25)
except urllib.error.HTTPError as error:r=error
with r:
 data=r.read();entry=dict(url=url,status=r.status,headers=dict(r.headers),milliseconds=round((time.monotonic()-start)*1000),retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),bytes=len(data));log.append(entry)
p.joinpath('latest-response.bin').write_bytes(data);p.joinpath('requests.json').write_text(json.dumps(log,indent=2));print(json.dumps(entry,indent=2));print(data[:300] if r.status!=200 else 'image retained')
