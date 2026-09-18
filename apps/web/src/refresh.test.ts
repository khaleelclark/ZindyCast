import test from 'node:test';import assert from 'node:assert/strict';import {startRefresh} from './refresh';
test('refresh coalesces wakeups, pauses hidden, resumes once due and stops without catch-up',async()=>{
 let now=0,enabled=true,calls=0;let finish:()=>void=()=>{};let id=0;const timers=new Map<number,()=>void>();
 const env={now:()=>now,setTimeout:(f:()=>void,_ms:number)=>{timers.set(++id,f);return id as unknown as ReturnType<typeof setTimeout>;},clearTimeout:(n:ReturnType<typeof setTimeout>)=>{timers.delete(n as unknown as number);}};
 const loop=startRefresh(()=>{calls++;return new Promise<void>(r=>{finish=r;});},()=>enabled,300000,env);
 assert.equal(calls,1);loop.wake();loop.wake();assert.equal(calls,1);finish();await Promise.resolve();loop.wake();assert.equal(calls,1);
 now=900000;enabled=false;loop.wake();assert.equal(calls,1);enabled=true;loop.wake();assert.equal(calls,2);loop.wake();assert.equal(calls,2);finish();await Promise.resolve();loop.stop();now+=900000;loop.wake();assert.equal(calls,2);assert.equal(timers.size,0);
});
