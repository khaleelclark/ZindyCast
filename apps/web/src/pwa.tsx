import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';

export function PwaStatus({ persist }: { persist: () => boolean }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [message, setMessage] = useState('');
  const applying = useRef(false);
  useEffect(() => {
    // Manifest/theme/lang are provided by the static HTML configuration.
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { setMessage('Offline installation is unavailable in this browser or connection.'); return; }
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const observed = new Set<ServiceWorkerRegistration>();
    const changed = () => { if (applying.current) window.location.reload(); };
    const observe = (reg: ServiceWorkerRegistration) => {
      const inspect = () => { if (!disposed) setWaiting(navigator.serviceWorker.controller ? reg.waiting : null); };
      inspect();
      if (observed.has(reg)) return;
      observed.add(reg);
      const installing = () => {
        const worker = reg.installing;
        if (worker) { worker.addEventListener('statechange', inspect); cleanup.push(() => worker.removeEventListener('statechange', inspect)); }
      };
      installing();
      reg.addEventListener('updatefound', installing);
      cleanup.push(() => reg.removeEventListener('updatefound', installing));
    };
    const register = async (build: string) => {
      const reg = await navigator.serviceWorker.register(`/sw.js?build=${encodeURIComponent(build)}`, { scope: '/', updateViaCache: 'none' });
      if (!disposed) observe(reg);
    };
    const assets = (doc: Document) => [...new Set([...doc.querySelectorAll('script[src],link[href]')].map(node => new URL(node.getAttribute('src') || node.getAttribute('href') || '/', location.origin)).filter(url => url.origin === location.origin && !url.search && /^\/static\/(js|css)\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname)).map(url => url.pathname))].sort().join('|');
    let checking = false;
    const check = async () => {
      if (!navigator.onLine || checking || disposed) return;
      checking = true;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        // Bypass shell cache to discover a new hashed release while keeping this page intact.
        const response = await fetch('/?shell-release-check=1', { cache: 'no-store', signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
        const build = assets(new DOMParser().parseFromString(await response.text(), 'text/html'));
        if (build && !disposed) await register(build);
      } catch { /* Offline/private-network failures leave the installed shell usable. */ }
      finally { clearTimeout(timer); checking = false; }
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    // Observe existing installs offline, but register only a freshly fetched release.
    // An old tab must never register the hashes from its own document.
    void navigator.serviceWorker.getRegistration('/').then(reg => { if (reg && !disposed) observe(reg); }).catch(() => {});
    void check();
    return () => { disposed = true; cleanup.forEach(remove => remove()); navigator.serviceWorker.removeEventListener('controllerchange', changed); window.removeEventListener('focus', check); window.removeEventListener('online', check); };
  }, []);
  function update() {
    if (!waiting || waiting.state !== 'installed') { setWaiting(null); setMessage('The available update changed. Return to this window to check again.'); return; }
    if (!persist()) { setMessage('Update paused because preferences could not be saved. Keep this page open to retain your current choices.'); return; }
    applying.current = true; setMessage('Applying update…'); waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
  return <>{waiting && <Alert severity="info" sx={{ my: 2 }} role="status" action={<Button color="inherit" variant="outlined" onClick={update}>Update and reload</Button>}>
    <AlertTitle>A newer ZindyCast is ready</AlertTitle>
    This tab is showing an older version. Update to get the latest maps and fixes. Your saved places and preferences will be kept.
  </Alert>}{message && <Alert severity="info" sx={{ my: 2 }} role="status">{message}</Alert>}</>;
}
