import { ApiErrorSchema } from '@zindycast/contracts';

/** Timeout includes response-body decoding; caller cancellation remains distinguishable. */
export type JsonRequestOptions = { method?: 'GET' | 'POST'; bearer?: string; body?: unknown };
export const requestJson = (url: string, signal: AbortSignal, timeoutMs = 20_000, options: JsonRequestOptions = {}): Promise<unknown> => {
  if ((options.bearer || options.method === 'POST') && (!url.startsWith('/api/v1/') || url.includes('\\') || !new URL(url, 'https://local.invalid').pathname.startsWith('/api/v1/'))) return Promise.reject(new Error('Protected requests require a local API path.'));
  const headers: Record<string, string> = {};
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  if (options.method === 'POST') { headers['X-ZindyCast-Request'] = '1'; headers['Content-Type'] = 'application/json'; }
  return requestBody(url, signal, response => response.json(), timeoutMs, { method: options.method ?? 'GET', headers, ...(options.method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}), redirect: options.bearer || options.method === 'POST' ? 'error' : 'follow' });
};
export const requestCsv = (url: string, signal: AbortSignal, timeoutMs = 20_000): Promise<Blob> => requestBody(url, signal, async response => {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/csv')) throw new Error('The export service did not return CSV.');
  return response.blob();
}, timeoutMs);
async function requestBody<T>(url: string, signal: AbortSignal, decode: (response: Response) => Promise<T>, timeoutMs: number, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
      if (error.success) throw new Error(error.data.code === 'not_configured' ? 'This service is not configured yet.' : error.data.message);
      throw new Error(response.status === 429 ? 'The service is busy. Please try again shortly.' : 'The service is unavailable. Check your connection and try again.');
    }
    return await decode(response);
  } catch (cause) {
    if (timedOut && !signal.aborted) throw new Error('The request timed out. Please try again.');
    throw cause;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
