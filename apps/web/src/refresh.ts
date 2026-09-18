/** Visible-page refresh: coalesced wakeups, bounded cadence, no backlog catch-up. */
export function startRefresh(task:()=>Promise<void>,enabled:()=>boolean,intervalMs:number,env={now:()=>Date.now(),setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clearTimeout:(id:ReturnType<typeof setTimeout>)=>clearTimeout(id)}) {
 let stopped=false,running=false,due=0,timer:ReturnType<typeof setTimeout>|undefined;
 function schedule(delay?:number){if(timer!==undefined)env.clearTimeout(timer);if(!stopped)timer=env.setTimeout(()=>{void wake();},delay ?? Math.max(1000,due-env.now()));}
 async function wake(){if(stopped||running)return;if(!enabled()){schedule(intervalMs);return;}if(env.now()<due){schedule();return;}running=true;try{await task();}finally{running=false;due=env.now()+intervalMs;schedule();}}
 void wake();return {wake:()=>{void wake();},stop:()=>{stopped=true;if(timer!==undefined)env.clearTimeout(timer);}};
}
