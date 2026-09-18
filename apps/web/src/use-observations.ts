import { useEffect, useState } from 'react';
import type { Location } from '@zindycast/contracts';
import type { ObservationsResponse } from '../../../packages/contracts/src/observations';
import { parseObservedResponse } from './observed-current';
import { requestJson } from './request';
import { startRefresh } from './refresh';

/** One observation request stream shared by the headline and station explorer. */
export function useObservations(location: Location | null, online: boolean, active: boolean, refreshKey: number) {
  const [data, setData] = useState<ObservationsResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [checked, setChecked] = useState<{latitude:number;longitude:number;time:number}|null>(null);
  const latitude = location?.latitude, longitude = location?.longitude;
  useEffect(() => {
    setData(previous => online && active && previous?.data.query.latitude === latitude && previous?.data.query.longitude === longitude ? previous : null); setError(''); setBusy(false);
    if (latitude === undefined || longitude === undefined || !online || !active) return;
    const controller = new AbortController();
    const requested = { latitude, longitude };
    let firstRequest = true;
    const refresh = startRefresh(async () => {
      setBusy(true);
      try {
        const manual = firstRequest && (refreshKey > 0 || retry > 0); firstRequest = false;
        const result = parseObservedResponse(await requestJson(`/api/v1/observations?${new URLSearchParams({
          latitude: String(latitude), longitude: String(longitude), ...(manual ? {refresh:'1'} : {}),
        })}`, controller.signal), requested);
        if (!controller.signal.aborted) { setData(result); setError(''); setChecked({latitude,longitude,time:Date.now()}); }
      } catch (cause) {
        if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Station readings unavailable.'); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }, () => !document.hidden && navigator.onLine, 300_000);
    const resume = () => refresh.wake();
    document.addEventListener('visibilitychange', resume); window.addEventListener('focus', resume);
    return () => { controller.abort(); refresh.stop(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume); };
  }, [latitude, longitude, online, active, refreshKey, retry]);
  // Synchronous geography/online binding prevents one render of the previous location.
  const matching = online && active && data?.data.query.latitude === latitude && data?.data.query.longitude === longitude;
  return { data: matching ? data : null, checkedAt: matching && checked?.latitude === latitude && checked?.longitude === longitude ? checked?.time ?? null : null, error, busy, refresh: () => setRetry(value => value + 1) };
}
