import React from 'react';
import { Button } from '@mui/material';
import type { Forecast } from '@zindycast/contracts';
import { eligibleCurrent } from './current-conditions';
import { acceptedObservationValue, type ObservedCurrent } from './observed-current';
import { FeelsLikeGauge } from './feels-like-gauge';
import { WindCompass } from './dashboard-visuals';
import { WeatherIcon } from './weather-appearance';
import { astronomyForDate, conditions, currentHour, dailyGroups, dayKey, rain, speed, temperature, timeLabel, type Units } from './weather';

export function CurrentOverview({ forecast, observed, units, zone, now, fresh, busy, stationBusy, stationError, stationCheckedAt, refresh }: {
  forecast: Forecast | undefined; observed: ObservedCurrent | null; units: Units; zone: string; now: number;
  fresh: boolean; busy: boolean; stationBusy: boolean; stationError?: string; stationCheckedAt?: number | null; refresh: () => void;
}) {
  const hour = forecast && currentHour(forecast.hours, now);
  const modeled = eligibleCurrent(forecast, now, fresh) ?? hour;
  const today = forecast && dailyGroups(forecast, now, 1)[0];
  const astronomy = forecast && astronomyForDate(forecast, dayKey(new Date(now).toISOString(), zone));
  const temp = (value: number | null | undefined) => temperature(value, units);
  const time = (value: string) => timeLabel(value, zone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const value = (key: Parameters<typeof acceptedObservationValue>[1]) => acceptedObservationValue(observed?.observation, key);
  const air = observed ? observed.temperatureC : modeled?.temperatureC;
  const humidity = observed ? observed.humidityPercent : modeled?.humidityPercent;
  const wind = observed ? observed.windSpeedMs : modeled?.windSpeedMs;
  const feels = observed ? observed.feelsLike.valueC : modeled?.apparentTemperatureC;
  const distance = observed && `${(observed.station.distanceKm / (units === 'us' ? 1.609344 : 1)).toFixed(1)} ${units === 'us' ? 'mi' : 'km'}`;
  const method = observed && ({ 'heat-index': 'Heat index (shade)', 'wind-chill': 'Wind chill', 'air-temperature': 'Air temperature', unavailable: 'Feels like unavailable' }[observed.feelsLike.method]);
  const pressure = observed ? value('barometricPressurePa') : hour?.surfacePressureHpa == null ? null : hour.surfacePressureHpa * 100;
  const visibility = observed ? value('visibilityM') : hour?.visibilityM;
  const direction = observed ? value('windDirectionDeg') : modeled?.windDirectionDeg;
  return <div className="current-overview">
    <div className="current-summary" data-current-source={observed ? 'station' : 'model'}>
      <div className="section-top"><h2 className="current-location">Current conditions</h2>{!observed && <span className="weather-symbol"><WeatherIcon code={modeled?.weatherCode} isDay={modeled?.isDay} /></span>}</div>
      <p className="current-time subtle">{observed ? <>Nearby station · {time(observed.observation.time)} · {Math.floor((now - Date.parse(observed.observation.time)) / 60_000)} min ago</> : <>{!modeled ? 'Current conditions unavailable' : fresh ? 'Model estimate' : 'Previously retrieved model estimate'}{modeled && <> · {time(modeled.time)}</>}</>} <Button className="current-refresh-button" size="small" disabled={busy || stationBusy} onClick={refresh}>{stationBusy ? 'Refreshing…' : 'Refresh'}</Button></p>
      {stationCheckedAt != null && !stationBusy && <p className="subtle station-refresh-status" role="status">Checked at {time(new Date(stationCheckedAt).toISOString())}{observed && ' · latest available station report shown'}</p>}
      {observed ? <p className="current-station subtle"><a href={observed.station.sourceUrl} target="_blank" rel="noreferrer">{observed.station.name} ({observed.station.stationId})</a> · {distance} away</p> : <p className="subtle">{stationBusy ? 'Checking nearby stations…' : stationError ? 'Station service unavailable. Showing the model estimate.' : 'No recent nearby station reading available.'}</p>}
      <FeelsLikeGauge valueC={feels} lowC={null} highC={null} units={units} fresh={!!observed || fresh} showForecastRange={false} />
      <p className="subtle feels-like-method">{observed ? <>{method}{observed.feelsLike.method !== 'unavailable' && ' · from this station’s readings'}</> : 'Open-Meteo feels-like estimate'}</p>
      <p className="actual">Air temperature <strong>{temp(air)}</strong>{observed ? observed.observation.textDescription && <span> · {observed.observation.textDescription}</span> : <span> · {conditions(modeled?.weatherCode)}</span>}</p>
      {today && <p className="today-temperature-range">Today’s forecast · High <strong>{temp(today.high)}</strong> · Low <strong>{temp(today.low)}</strong></p>}
      <div className="hero-bottom"><div><span>Humidity</span><strong>{humidity == null ? '—' : `${Math.round(humidity)}%`}</strong></div><div><span>{observed ? 'Station wind' : 'Wind · 10 m'}</span><strong>{speed(wind, units)}</strong></div><div><span>Forecast rain chance</span><strong>{hour?.precipitationProbability == null ? '—' : `${hour.precipitationProbability}%`}</strong></div></div>
    </div>
    <section className="current-details" aria-labelledby="current-details-heading"><h2 id="current-details-heading">A closer look</h2>
      <p className="subtle">{observed ? <>Same station · {time(observed.observation.time)}</> : <>Hourly forecast details{hour && <> · {time(hour.time)}</>}</>}</p>
      <WindCompass direction={direction} wind={wind} units={units} heightLabel={observed ? 'Station reading' : '10 m'} />
      <dl>
        <div><dt>Dew point</dt><dd>{temp(observed ? value('dewPointC') : hour?.dewPointC)}</dd></div>
        <div><dt>{observed ? 'Station pressure' : 'Surface pressure'}</dt><dd>{pressure == null ? '—' : units === 'us' ? `${(pressure / 3386.389).toFixed(2)} inHg` : `${Math.round(pressure / 100)} hPa`}</dd></div>
        <div><dt>Wind gusts</dt><dd>{speed(observed ? value('windGustMs') : hour?.windGustMs, units)}</dd></div>
        <div><dt>Wind direction</dt><dd>{direction == null ? '—' : `${Math.round(direction)}° from north`}</dd></div>
        <div><dt>Preceding-hour rain</dt><dd>{rain(observed ? value('precipitationLastHourMm') : hour?.precipitationMm, units)}</dd></div>
        <div><dt>Visibility</dt><dd>{visibility == null ? '—' : `${(visibility / (units === 'us' ? 1609.344 : 1000)).toFixed(1)} ${units === 'us' ? 'mi' : 'km'}`}</dd></div>
      </dl>
      <p className="subtle">Forecast extras{hour && <> · {time(hour.time)}</>}</p>
      <dl><div><dt>UV index</dt><dd>{hour?.uvIndex == null ? '—' : hour.uvIndex.toFixed(1)}</dd></div><div><dt>Cloud cover</dt><dd>{hour?.cloudCoverPercent == null ? '—' : `${Math.round(hour.cloudCoverPercent)}%`}</dd></div>
        <div><dt>Sunrise / sunset</dt><dd>{astronomy?.sunrise ? time(astronomy.sunrise) : '—'} / {astronomy?.sunset ? time(astronomy.sunset) : '—'}</dd></div></dl>
    </section>
  </div>;
}
