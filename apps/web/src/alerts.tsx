import { Button, Card } from '@mui/material';
import { useEffect, useState } from 'react';
import { AlertsResponseSchema, type AlertsData, type Location } from '@zindycast/contracts';
import { requestJson } from './request';
import { timeLabel } from './weather';

export function parseAlerts(raw: unknown, location: Pick<Location, 'latitude' | 'longitude'>) {
  const result = AlertsResponseSchema.parse(raw);
  if (result.status === 'error') throw new Error(result.code === 'not_configured' ? 'Official alerts are not configured yet.' : result.message);
  if (result.data.coordinates.latitude !== location.latitude || result.data.coordinates.longitude !== location.longitude) throw new Error('Alerts did not match the selected location. Please retry.');
  return result;
}
export function currentAlerts(alerts: AlertsData['alerts'], now: number) {
  return alerts.filter(alert => alert.status === 'Actual' && alert.messageType !== 'Cancel'
    && (alert.expires === null || Date.parse(alert.expires) > now)
    && (alert.ends === null || Date.parse(alert.ends) > now));
}
export function officialLink(value: string | null) {
  if (!value) return 'https://www.weather.gov/';
  const url = new URL(value);
  return url.protocol === 'https:' && (url.hostname === 'weather.gov' || url.hostname.endsWith('.weather.gov')) ? url.href : 'https://www.weather.gov/';
}
export function AlertsPanel({ location, online, now }: { location: Location; online: boolean; now: number }) {
  const [result, setResult] = useState<ReturnType<typeof parseAlerts> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    const timer = window.setInterval(refresh, 300_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(''); setLoading(online);
    if (online) void (async () => {
      try {
        const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude) });
        const parsed = parseAlerts(await requestJson(`/api/v1/alerts?${params}`, controller.signal), location);
        if (!controller.signal.aborted) setResult(parsed);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Official alerts unavailable.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [location.latitude, location.longitude, online, retry]);
  const data = online ? result?.data : undefined;
  const alerts = data ? currentAlerts(data.alerts, now) : [];
  const stamp = (value: string | null) => value ? timeLabel(value, location.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Not provided';
  if (data && !alerts.length && result?.freshness === 'fresh' && now - Date.parse(data.retrievedAt) <= 300_000) return <details className="alerts-quiet" aria-label="Official alerts"><summary>NWS · No active alerts.</summary><p>{data.attribution} · Retrieved {stamp(data.retrievedAt)}. Checked every five minutes and on return.</p><Button onClick={() => setRetry(value => value + 1)}>Refresh alerts</Button><a href="https://www.weather.gov/">NWS forecasts and warnings</a></details>;
  return <Card component="section" className="card alerts-card" aria-labelledby="alerts-heading"><div className="section-top"><div><h2 id="alerts-heading">Official alerts <small>· NWS</small></h2></div><Button className="outline" disabled={!online || loading} onClick={() => setRetry(value => value + 1)}>Refresh alerts</Button></div>
    <div role="status">{!online ? <p>Official alerts are unavailable offline.</p> : loading ? <p>Checking official alerts for {location.name}…</p> : error ? <p className="notice error">{error}</p> : null}</div>
    {data && <>{(result?.freshness === 'stale' || now - Date.parse(data.retrievedAt) > 300_000) && <p className="notice">Previously retrieved alerts may be out of date. Refresh to check for updates or cancellations.</p>}
      {!alerts.length && <p>No active alerts reported.</p>}
      {alerts.map(alert => <article className="official-alert" key={alert.id}><div className="alert-summary"><h3>{alert.event}</h3><p><strong>{alert.severity}</strong> severity · Expires {stamp(alert.expires)}</p></div><details><summary>Official text, affected areas & timing<span className="sr-only"> · {alert.event}</span></summary>{alert.headline && <p>{alert.headline}</p>}<p className="subtle">{alert.urgency} urgency · {alert.certainty} certainty<br />Status: {alert.status} · {alert.messageType}<br />Sent: {stamp(alert.sent)} · Effective: {stamp(alert.effective)}<br />Onset: {stamp(alert.onset)} · Ends: {stamp(alert.ends)}</p><p className="subtle">Area: {alert.areaDesc}</p><p>Issued by {alert.senderName}</p><div className="official-text">{alert.description}</div>{alert.instruction ? <><h4>Official instructions</h4><div className="official-text">{alert.instruction}</div></> : <p>No additional instructions supplied.</p>}<a href={officialLink(alert.web)} target="_blank" rel="noreferrer">View National Weather Service ↗</a></details></article>)}
      <details><summary>Alert source & refresh timing</summary><p className="subtle">{data.attribution} · Retrieved {stamp(data.retrievedAt)}. Retrieval time is not an alert issue time. Updates are checked every five minutes while this page is open and on return to the window.</p><a href="https://www.weather.gov/" target="_blank" rel="noreferrer">NWS forecasts and warnings ↗</a></details></>}
  </Card>;
}
