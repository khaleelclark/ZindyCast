import {Button,Checkbox,FormControlLabel,FormGroup} from '@mui/material';
import {useEffect,useRef,useState} from 'react';
import type {Location} from '@zindycast/contracts';
import {NotificationStatusSchema,NotificationPreferencesSchema,type NotificationStatus} from '../../../packages/contracts/src/notifications';
import {installationStore} from './comparison-model';
import {requestJson} from './request';
import {placeLabel} from './weather';
export function NotificationSettings({saved,online}:{saved:Location[];online:boolean}) {
  const [status,setStatus]=useState<NotificationStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
  const [selected,setSelected]=useState<string[]>([]),[start,setStart]=useState(22),[end,setEnd]=useState(7),[urgent,setUrgent]=useState(true);
  const pending=useRef(false),abort=useRef<AbortController|null>(null),store=useRef<ReturnType<typeof installationStore>|null>(null);
  const access=()=>store.current??=installationStore(localStorage);
  const supported=typeof window!=='undefined'&&window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window;
  const locations=[...new Map([...(status?.preferences?.locations??[]),...saved].map(l=>[`${l.latitude},${l.longitude}`,l])).values()];
  useEffect(()=>{const c=new AbortController();setError('');setStatus(null);if(online)void(async()=>{try{const bearer=access().existing(Date.now())??undefined;const s=NotificationStatusSchema.parse(await requestJson('/api/v1/notifications',c.signal,20000,{bearer}));if(!c.signal.aborted){setStatus(s);setSelected(s.preferences?.locations.map(l=>`${l.latitude},${l.longitude}`)??[]);setStart(s.preferences?.quietStart??22);setEnd(s.preferences?.quietEnd??7);setUrgent(s.preferences?.urgentDuringQuiet??true);}}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Notification settings unavailable.');}})();return()=>c.abort();},[online,version]);
  useEffect(()=>{if(!online)abort.current?.abort();return()=>abort.current?.abort();},[online]);
  async function save(){
    if(pending.current||!online||!status?.configured||!status.publicKey||!supported)return;
    const parsed=NotificationPreferencesSchema.safeParse({locations:locations.filter(l=>selected.includes(`${l.latitude},${l.longitude}`)),quietStart:start,quietEnd:end,urgentDuringQuiet:urgent});
    if(!parsed.success){setError('Choose 1–5 distinct saved places.');return;}
    pending.current=true;setBusy(true);setError('');const c=new AbortController();abort.current=c;
    try {
      // Request permission directly from the button gesture, before any network work.
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted')throw new Error('Notifications are blocked. You can change this in browser settings.');
      c.signal.throwIfAborted();
      const reg=await navigator.serviceWorker.getRegistration('/');if(!reg?.active)throw new Error('Install or reload the app first so its notification service is ready. On iPhone, open the Home Screen app.');
      const bearer=access().existing(Date.now())??(navigator.locks?await navigator.locks.request('zindycast.installation-registration',{signal:c.signal},()=>access().ensure(c.signal)):null);
      if(!bearer)throw new Error('This browser cannot safely register this installation.');
      const key=Uint8Array.from(atob(status.publicKey.replace(/-/g,'+').replace(/_/g,'/')),s=>s.charCodeAt(0));
      const subscription=await reg.pushManager.getSubscription()??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      c.signal.throwIfAborted();
      const response=NotificationStatusSchema.parse(await requestJson('/api/v1/notifications',c.signal,20000,{method:'POST',bearer,body:{subscription:subscription.toJSON(),preferences:parsed.data}}));
      if(!c.signal.aborted)setStatus(response);
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Unable to save notifications. Check status before retrying.');}
    finally{pending.current=false;setBusy(false);}
  }
  async function disable(){
    if(pending.current||!online)return;pending.current=true;setBusy(true);setError('');const c=new AbortController();abort.current=c;
    try{const bearer=access().existing(Date.now());if(bearer)await requestJson('/api/v1/notifications/disable',c.signal,20000,{method:'POST',bearer});
      if(supported){const reg=await navigator.serviceWorker.getRegistration('/');const sub=await reg?.pushManager.getSubscription();await sub?.unsubscribe();}
      if(!c.signal.aborted)setVersion(v=>v+1);
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not confirm notifications are disabled.');}finally{pending.current=false;setBusy(false);}
  }
  return <section aria-labelledby="notification-settings-title"><h2 id="notification-settings-title">Warning notifications</h2>
    <p>Official NWS severe and extreme warnings for the places you choose. Your dashboard activity choice does not change these alerts.</p>
    {!supported&&<p>Use a supported browser over HTTPS. On iPhone, add ZindyCast to your Home Screen and open it there.</p>}
    {!online?<p role="status">Reconnect to manage notifications.</p>:status&&!status.configured?<p role="status">Notifications need server setup before they can be enabled.</p>:null}
    {status?.enabled&&<p role="status">Enabled for this installation. {status.lastCheckedAt?`Last checked ${new Date(status.lastCheckedAt).toLocaleString()}.`:'Waiting for the first check.'}{status.lastOutcome==='source_unavailable'?' The warning source could not be checked.':status.lastOutcome==='delivery_failed'?' A notification could not be delivered.':''}</p>}
    <fieldset disabled={busy||!online||!status?.configured}><legend>Places to monitor</legend><FormGroup>{locations.length?locations.map(l=>{const id=`${l.latitude},${l.longitude}`;return <FormControlLabel key={id} control={<Checkbox checked={selected.includes(id)} onChange={e=>setSelected(p=>e.target.checked?[...p,id]:p.filter(v=>v!==id))}/>} label={placeLabel(l)}/>;}):<p>Save a place on Today to enable its warnings.</p>}</FormGroup>
    <label>Quiet hours start <select value={start} onChange={e=>setStart(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</select></label>
    <label>Quiet hours end <select value={end} onChange={e=>setEnd(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</select></label>
    <p>Hours follow each monitored place’s local time. Matching start and end turns quiet hours off.</p>
    <FormControlLabel control={<Checkbox checked={urgent} onChange={e=>setUrgent(e.target.checked)}/>} label="Allow immediate severe and extreme warnings during quiet hours"/></fieldset>
    <div className="actions"><Button onClick={()=>void save()} disabled={busy||!online||!supported||!status?.configured}>{status?.enabled?'Save warning settings':'Enable warning notifications'}</Button><Button onClick={()=>void disable()} disabled={busy||!online}>Disable notifications</Button><Button onClick={()=>setVersion(v=>v+1)} disabled={busy||!online}>Check notification status</Button></div>
    {error&&<p role="alert">{error}</p>}
    <details><summary>Delivery and privacy</summary><p>Delivery is best effort and may be delayed or missed. Keep official emergency alerts enabled on your phone. This app checks saved places, not your live background location. Opening details requires access to your private ZindyCast connection.</p><p>Previously delivered warnings can change or be cancelled; open the app for current official information. Disable stops new attempts; a message already in transit may still arrive. No automatic retry after an uncertain send, to avoid duplicate warnings.</p><p>Turning this on stores the browser’s push endpoint and selected places privately on this server. Turning it off removes that subscription. Browser permission alone does not enable ZindyCast warnings.</p></details>
  </section>;
}
