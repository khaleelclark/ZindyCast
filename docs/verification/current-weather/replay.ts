import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CurrentWeatherSchema } from '../../../packages/contracts/src/current-weather.js';
const raw=JSON.parse(await readFile(new URL('./live-current.json',import.meta.url),'utf8'));
const data=CurrentWeatherSchema.parse({time:new Date(raw.current.time*1000).toISOString(),intervalSeconds:raw.current.interval,temperatureC:raw.current.temperature_2m,apparentTemperatureC:raw.current.apparent_temperature,humidityPercent:raw.current.relative_humidity_2m,windSpeedMs:raw.current.wind_speed_10m,windDirectionDeg:raw.current.wind_direction_10m,weatherCode:raw.current.weather_code,isDay:raw.current.is_day,cloudCoverPercent:raw.current.cloud_cover});
assert.equal(data.time,'2026-09-12T20:00:00.000Z');assert.equal(data.intervalSeconds,900);
console.log(JSON.stringify({status:'PASS',sourceCoordinates:{latitude:raw.latitude,longitude:raw.longitude},data},null,2));
