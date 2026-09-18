import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationCell, type ReanalysisHour } from '@zindycast/contracts';
import { availableStats, historyDailyRows, stationVisualValue } from './history-visuals';
test('available summaries preserve zero, negative and all-missing values without imputing', () => {
 assert.deepEqual(availableStats([null, 0, -6, 3]), { count: 3, low: -6, high: 3, mean: -1 });
 assert.deepEqual(availableStats([null]), { count: 0, low: null, high: null, mean: null });
});
test('daily ranges use UTC labels and available hour counts, never a fabricated complete day', () => {
 const hour = (time: string, temperatureC: number | null) => ({ time, temperatureC } as ReanalysisHour);
 assert.deepEqual(historyDailyRows([hour('2020-03-08T23:00:00.000Z', 0), hour('2020-03-09T00:00:00.000Z', -2), hour('2020-03-09T01:00:00.000Z', null)]), [{date:'2020-03-08',count:1,low:0,high:0,mean:0},{date:'2020-03-09',count:1,low:-2,high:-2,mean:-2}]);
});
test('station visual screen excludes QC failures, unknowns, traces and presumed zeros; retains real zero', () => {
 assert.equal(stationVisualValue(stationCell(0,' ',' ','7')), 0);
 assert.equal(stationVisualValue(stationCell(-25,' ',' ','7')), -2.5);
 for (const cell of [stationCell(100,' ','I','7'),stationCell(100,' ','J','7'),stationCell(0,'T',' ','7'),stationCell(0,'P',' ','0'),stationCell(100,'J',' ','j'),stationCell(-9999,' ',' ','7')]) assert.equal(stationVisualValue(cell),null);
});
