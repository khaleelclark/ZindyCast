import test from 'node:test';
import assert from 'node:assert/strict';
import {skyPhase} from './sky-phase';
test('lighting follows location sunrise and sunset instants through the entire day', () => {
  const astronomy = {sunrise:'2026-09-13T11:07:00Z',sunset:'2026-09-13T23:30:00Z'};
  for (const [time, phase] of [['09:00','night'],['10:30','dawn'],['11:30','dawn'],['12:00','day'],['23:00','dusk'],['23:59','dusk']] as const)
    assert.equal(skyPhase(Date.parse(`2026-09-13T${time}:00Z`),astronomy,1,true),phase);
  assert.equal(skyPhase(Date.parse('2026-09-14T01:00:00Z'),astronomy,0,true),'night');
});
test('offset/DST instants are equivalent and short days have nonoverlapping windows', () => {
  const a={sunrise:'2026-11-01T06:30:00-08:00',sunset:'2026-11-01T16:45:00-08:00'};
  assert.equal(skyPhase(Date.parse('2026-11-01T14:30:00Z'),a,0,true),'dawn');
  const short={sunrise:'2026-12-01T11:30:00Z',sunset:'2026-12-01T12:30:00Z'};
  assert.equal(skyPhase(Date.parse('2026-12-01T12:00:00Z'),short,1,true),'day');
});
test('missing or invalid astronomy uses supplied daylight, while stale data stays neutral', () => {
  for (const a of [undefined,{sunrise:null,sunset:null},{sunrise:'bad',sunset:'bad'},{sunrise:'2026-01-02',sunset:'2026-01-01'}]) {
    assert.equal(skyPhase(0,a,0,true),'night');
    assert.equal(skyPhase(0,a,1,true),'day');
    assert.equal(skyPhase(0,a,null,true),'neutral');
    assert.equal(skyPhase(0,a,1,false),'neutral');
  }
});
