"""Offline provisional screening, not verified scientific station selection."""
import csv,json,math,pathlib
P=pathlib.Path(__file__).parent
cities=json.loads((P/'candidates.json').read_text())
def distance(a,b,c,d):
    x,y,z,w=map(math.radians,[a,b,c,d])
    return 6371*2*math.asin(math.sqrt(math.sin((z-x)/2)**2+math.cos(x)*math.cos(z)*math.sin((w-y)/2)**2))
daily={l[:11]:dict(id=l[:11],latitude=float(l[12:20]),longitude=float(l[21:30]),elevation=float(l[31:37]),name=l[41:71].strip()) for l in (P/'ghcnd-stations-subset.txt').read_text().splitlines()}
inv={}
for l in (P/'ghcnd-inventory-subset.txt').read_text().splitlines():
    inv.setdefault(l[:11],{})[l[31:35]]=[int(l[36:40]),int(l[41:45])]
for c in cities:
    near=[]
    for r in daily.values():
        d=distance(c['latitude'],c['longitude'],r['latitude'],r['longitude']);iv=inv.get(r['id'],{})
        if d<=75 and all(v in iv for v in ['TMAX','TMIN','PRCP']):
            near.append(dict(r,distance_km=round(d,2),inventory=iv))
    near.sort(key=lambda r:(r['distance_km'],r['id']))
    c['daily_nearest_three_core_inventory']=near[:4]
    c['daily_inventory_covers_baseline_and_recent_candidates']=[r for r in near if all(r['inventory'][v][0]<=1991 and r['inventory'][v][1]>=2025 for v in ['TMAX','TMIN','PRCP'])][:3]
(P/'candidates.json').write_text(json.dumps(cities,indent=2)+'\n')
for c in cities:
    print(c['city'],[(r['id'],r['name'],r['distance_km'],r['elevation'],r['inventory']['TMAX']) for r in c['daily_inventory_covers_baseline_and_recent_candidates']])
