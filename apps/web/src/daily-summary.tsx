import React from 'react';
import type { Forecast, Hour } from '@zindycast/contracts';
import { HourlyStrip } from './dashboard-visuals';
import { dailyPlanningSummary, temperature, type Units } from './weather';
import { metricStatisticLabel } from './metric-display';

export function DailySummary({ forecast, upcoming, now, units }: { forecast: Forecast; upcoming: Hour[]; now: number; units: Units }) {
  const days = dailyPlanningSummary(forecast, now);
  return <section className="daily-summary" aria-labelledby="daily-summary-heading">
    <div className="daily-summary-heading"><div><p className="eyebrow">At a glance</p><h2 id="daily-summary-heading">Today and tomorrow</h2></div><p className="subtle">Forecast estimates · local time</p></div>
    <div className="planning-days">{days.map(day => <article key={day.key}>
      <h3>{day.label}</h3><p><strong>{day.condition}.</strong> High {temperature(day.high, units)} · low {temperature(day.low, units)}. <span>{day.rainChance == null ? 'Hourly rain chance unavailable.' : `${metricStatisticLabel('precipitationProbabilityPercent', 'maximum', 'day')}: ${day.rainChance}%${day.rainPeriod ? `, ${day.rainPeriod}` : ''}.`}</span></p>
      {day.partial && <small>Partial forecast; summary uses available hours.</small>}
    </article>)}</div>
    <div className="next-hours-heading"><h3>Next six hours</h3><a href="#hourly">See 48-hour detail</a></div>
    <HourlyStrip hours={upcoming.slice(0, 6)} units={units} zone={forecast.location.timezone} />
  </section>;
}
