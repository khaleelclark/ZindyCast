import test from 'node:test';
import assert from 'node:assert/strict';
import { closeRepositories } from './shutdown.js';

test('shutdown attempts every database close and counts failures without exposing details', () => {
  const calls: number[] = [];
  assert.equal(closeRepositories([0, 1, 2].map(i => ({ close() {
    calls.push(i); if (i !== 1) throw new Error('sensitive injected details');
  } }))), 2);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.equal(closeRepositories([{ close() {} }]), 0);
});
