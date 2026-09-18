"""Offline evidence verification; never requests the network."""
import json,pathlib,math
p=pathlib.Path(__file__).parent
d=json.loads((p/'live-response.json').read_text()); r=json.loads((p/'live-request.json').read_text())
assert r['status']==200 and r['requestCount']==1 and r['retries']==0
units={'temperature_2m':'°C','relative_humidity_2m':'%','precipitation':'mm','wind_speed_10m':'m/s','dew_point_2m':'°C','wet_bulb_temperature_2m':'°C','sunshine_duration':'s','cloud_cover':'%','weather_code':'wmo code','is_day':'','shortwave_radiation':'W/m²'}
assert d['utc_offset_seconds']==0 and d['hourly_units']['time']=='unixtime'
assert d['hourly']['time']==list(range(1752537600,1752624000,3600))
for k,u in units.items():
 assert d['hourly_units'][k]==u
 assert len(d['hourly'][k])==24
 assert all(x is None or (isinstance(x,(int,float)) and math.isfinite(x)) for x in d['hourly'][k])
for k,lo,hi in [('relative_humidity_2m',0,100),('cloud_cover',0,100),('sunshine_duration',0,3600),('is_day',0,1)]:
 assert all(lo<=x<=hi for x in d['hourly'][k] if x is not None)
for k in ['precipitation','wind_speed_10m','shortwave_radiation']:
 assert all(x>=0 for x in d['hourly'][k] if x is not None)
assert set(d['hourly']['weather_code']) <= {0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99}
assert d['daily_units']=={'time':'unixtime','sunrise':'unixtime','sunset':'unixtime','daylight_duration':'s'}
assert all(len(v)==1 for v in d['daily'].values())
assert 0<=d['daily']['daylight_duration'][0]<=86400
print('PASS retained ERA5 response: 24 contiguous UTC hours, 11 hourly fields, 3 daily fields, exact units and range checks; no network.')
