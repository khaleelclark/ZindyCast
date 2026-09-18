import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SharedStorage} from './index';
const DAY=86400000;
test('Mapbox reservations persist, share the final slot, retain at least32days, and reject backwards clocks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mapbox-budget-'));const path=join(dir,'db.sqlite');let clock=Date.UTC(2026,8,12,12);let a:SharedStorage|undefined,b:SharedStorage|undefined,seed:DatabaseSync|undefined;
 try{
  a=new SharedStorage({path,clock:()=>clock});assert.equal(a.reserveMapboxRequest().used,1);a.close();a=undefined;
  b=new SharedStorage({path,clock:()=>clock});assert.equal(b.reserveMapboxRequest().used,2);
  seed=new DatabaseSync(path);seed.prepare('UPDATE zc_mapbox_budget SET used=189999').run();
  a=new SharedStorage({path,clock:()=>clock});assert.deepEqual(a.reserveMapboxRequest(),{allowed:true,used:190000,limit:190000});assert.equal(b.reserveMapboxRequest().allowed,false);
  clock+=32*DAY;assert.equal(b.reserveMapboxRequest().allowed,false);
  clock=Math.floor(clock/DAY)*DAY+DAY;assert.deepEqual(a.reserveMapboxRequest(),{allowed:true,used:1,limit:190000});
  clock-=1;assert.throws(()=>b!.reserveMapboxRequest(),/backwards/);
  clock+=1;seed.prepare('INSERT INTO zc_mapbox_budget VALUES (?,1)').run(Math.floor(clock/DAY)+1);assert.throws(()=>a!.reserveMapboxRequest(),/Invalid Mapbox budget/);
 }finally{a?.close();b?.close();seed?.close();rmSync(dir,{recursive:true,force:true});}
});
test('Mapbox storage failure never grants a permit',()=>{const s=new SharedStorage({path:':memory:'});s.close();assert.throws(()=>s.reserveMapboxRequest());});
