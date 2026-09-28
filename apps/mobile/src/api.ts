import { AlertsResponseSchema, ForecastResponseSchema, SearchResponseSchema, type Location } from '@zindycast/contracts';
import { sameLocation } from './weather';
export let API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/$/, '');
export function validateBase(base: string, release = false) {
  if (!base) throw new Error('Open Server settings and enter your device-reachable ZindyCast HTTPS origin.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('API base must be an HTTP(S) origin without credentials, path, or query.');
  if (release) {
    if (url.protocol !== 'https:') throw new Error('Standalone builds require a trusted HTTPS server origin.');
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const placeholder = /(^|\.)(example|invalid|test|localhost)$/.test(host) || /(^|\.)example\.(com|org|net)$/.test(host);
    const loopback = /^127\./.test(host) || ['0.0.0.0', '[::]', '[::1]', '10.0.2.2'].includes(host) || /^\[::ffff:(7f[0-9a-f]{2}:|127\.)/.test(host);
    if (placeholder || loopback) throw new Error('Enter the real device-reachable HTTPS server address, not a placeholder or loopback address. Connect Tailscale if required.');
  }
  return base;
}
export function configureApi(base: string) {
  const normalized = base.trim().replace(/\/$/, '');
  validateBase(normalized, typeof __DEV__ !== 'undefined' && !__DEV__);
  API_BASE = normalized;
}
export async function request(path: string, signal: AbortSignal): Promise<unknown> {
  configureApi(API_BASE);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 20000);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/v1${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error('Cannot reach the weather server. Check your connection, enable Tailscale if required, and verify the HTTPS address in Server settings. Then retry.');
    }
    if (!response.ok) throw new Error(`Service unavailable (${response.status}). Try again shortly.`);
    return await response.json();
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export async function search(query: string, signal: AbortSignal) {
  const locations = SearchResponseSchema.parse(await request(`/locations?q=${encodeURIComponent(query)}`, signal)).locations;
  for (const location of locations) new Intl.DateTimeFormat('en-US', { timeZone: location.timezone });
  return locations;
}
export async function forecast(location: Location, signal: AbortSignal) {
  const params = new URLSearchParams();
  Object.entries(location).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  const result = ForecastResponseSchema.parse(await request(`/forecast?${params}`, signal));
  if (result.status === 'error') throw new Error(result.message);
  if (!sameLocation(result.data.location, location)) throw new Error('Forecast location did not match the selected city.');
  return result;
}
export async function alerts(location: Location, signal: AbortSignal) {
  const result = AlertsResponseSchema.parse(await request(`/alerts?latitude=${location.latitude}&longitude=${location.longitude}`, signal));
  if (result.status === 'error') throw new Error(result.message);
  if (result.data.coordinates.latitude !== location.latitude || result.data.coordinates.longitude !== location.longitude) throw new Error('Alert location did not match the selected city.');
  return result;
}
