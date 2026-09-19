import { DatabaseSync } from 'node:sqlite';
import { LocationSchema, WetBulbTrackerRecordSchema, type Location, type WetBulbTrackerRecord } from '@zindycast/contracts';

export const TRACKER_CADENCE_MS = 30 * 60_000;
export const TRACKER_RETENTION_DAYS = 90;

export function wetBulbTrackerLocation(env: NodeJS.ProcessEnv = process.env): Location | null {
  if (env.ZINDYCAST_WET_BULB_TRACKER !== '1') return null;
  return LocationSchema.parse({ id: 'wet-bulb-tracker', name: env.ZINDYCAST_WET_BULB_NAME,
    latitude: Number(env.ZINDYCAST_WET_BULB_LATITUDE), longitude: Number(env.ZINDYCAST_WET_BULB_LONGITUDE),
    timezone: env.ZINDYCAST_WET_BULB_TIMEZONE, country: env.ZINDYCAST_WET_BULB_COUNTRY ?? 'US',
    admin1: env.ZINDYCAST_WET_BULB_ADMIN1, admin2: env.ZINDYCAST_WET_BULB_ADMIN2 });
}

export class WetBulbTrackerStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path); this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS wet_bulb_records(
      recorded_at INTEGER PRIMARY KEY, source_valid_time INTEGER NOT NULL, retrieved_at INTEGER NOT NULL,
      ordinary_wet_bulb_c REAL, wbgt_c REAL, temperature_c REAL, dew_point_c REAL, humidity_percent REAL,
      apparent_temperature_c REAL, wind_speed_ms REAL, precipitation_probability REAL, is_day INTEGER,
      provider TEXT NOT NULL CHECK(provider='Open-Meteo'), classification TEXT NOT NULL CHECK(classification='modeled')) STRICT;`);
  }
  latestTime(): number | null { const row=this.db.prepare('SELECT max(recorded_at) value FROM wet_bulb_records').get(); return row?.value==null?null:Number(row.value); }
  latest(): WetBulbTrackerRecord | null { return this.list(0)[0]??null; }
  add(record: WetBulbTrackerRecord) { const r=WetBulbTrackerRecordSchema.parse(record); this.db.prepare(`INSERT OR IGNORE INTO wet_bulb_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    Date.parse(r.recordedAt),Date.parse(r.sourceValidTime),Date.parse(r.retrievedAt),r.ordinaryWetBulbC,r.wbgtC,r.temperatureC,r.dewPointC,r.humidityPercent,r.apparentTemperatureC,r.windSpeedMs,r.precipitationProbability,r.isDay,r.provider,r.classification); }
  list(since: number): WetBulbTrackerRecord[] { return this.db.prepare('SELECT * FROM wet_bulb_records WHERE recorded_at>=? ORDER BY recorded_at DESC LIMIT 5000').all(since).map((row:any)=>WetBulbTrackerRecordSchema.parse({
    recordedAt:new Date(Number(row.recorded_at)).toISOString(),sourceValidTime:new Date(Number(row.source_valid_time)).toISOString(),retrievedAt:new Date(Number(row.retrieved_at)).toISOString(),ordinaryWetBulbC:row.ordinary_wet_bulb_c,wbgtC:row.wbgt_c,temperatureC:row.temperature_c,dewPointC:row.dew_point_c,humidityPercent:row.humidity_percent,apparentTemperatureC:row.apparent_temperature_c,windSpeedMs:row.wind_speed_ms,precipitationProbability:row.precipitation_probability,isDay:row.is_day,provider:row.provider,classification:row.classification})); }
  cleanup(now=Date.now()) { return Number(this.db.prepare('DELETE FROM wet_bulb_records WHERE recorded_at<?').run(now-TRACKER_RETENTION_DAYS*86400000).changes); }
  close(){this.db.close();}
}
