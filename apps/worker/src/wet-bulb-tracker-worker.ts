import { ForecastSchema, WetBulbTrackerRecordSchema, type Forecast, type Location } from '@zindycast/contracts';
import { getForecast } from '@zindycast/providers';
import { CachedRequests } from '../../api/src/cache.js';
import { TRACKER_CADENCE_MS, type WetBulbTrackerStore } from '../../api/src/wet-bulb-tracker-store.js';
import type { SharedStorage } from '@zindycast/storage';
export class WetBulbTrackerWorker{
 private readonly cached:CachedRequests;
 constructor(private store:WetBulbTrackerStore,private location:Location,storage:SharedStorage,private clock=()=>Date.now()){this.cached=new CachedRequests(storage);}
 async runOnce(signal?:AbortSignal){const now=this.clock(),latest=this.store.latestTime();if(latest!==null&&now-latest<TRACKER_CADENCE_MS)return false;
  const schema=ForecastSchema.refine(f=>f.location.latitude===this.location.latitude&&f.location.longitude===this.location.longitude&&f.location.timezone===this.location.timezone);
  const key=`forecast:v6:28-fields:current:astronomy:wbgt-fao-instant-v1:360h:past1:utc:si:${JSON.stringify(this.location)}`;
  const result=await this.cached.get(key,schema,3,300000,0,()=>getForecast(this.location,signal),'open-meteo',10000);const forecast:Forecast=result.data;
  const hour=forecast.hours.reduce((best,item)=>Math.abs(Date.parse(item.time)-now)<Math.abs(Date.parse(best.time)-now)?item:best,forecast.hours[0]!);
  this.store.add(WetBulbTrackerRecordSchema.parse({recordedAt:new Date(now).toISOString(),sourceValidTime:hour.time,retrievedAt:forecast.provenance.retrievedAt,ordinaryWetBulbC:hour.ordinaryWetBulbC,wbgtC:hour.wbgt?.valueC??null,temperatureC:hour.temperatureC,dewPointC:hour.dewPointC,humidityPercent:hour.humidityPercent,apparentTemperatureC:hour.apparentTemperatureC,windSpeedMs:hour.windSpeedMs,precipitationProbability:hour.precipitationProbability,isDay:hour.isDay??null,provider:'Open-Meteo',classification:'modeled'}));this.store.cleanup(now);return true; }
}
