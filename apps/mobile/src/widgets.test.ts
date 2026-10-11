import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { widgetBridgeScript, widgetPreferences } from './widgets';

const server = 'https://weather.family.ts.net';
const location = { id: 'honolulu', country: 'United States', name: 'Honolulu', latitude: 21.3, longitude: -157.8, timezone: 'Pacific/Honolulu' };
const message = (selected: unknown = location, units = 'us') => JSON.stringify({ type: 'zindycast.widget.preferences', preferences: { selected, units } });
test('widgets accept first-party city/units and explicit selection clearing', () => {
  assert.deepEqual(widgetPreferences(message(), server + '/#Today', server), { server, location, units: 'us' });
  assert.equal(widgetPreferences(message(null, 'metric'), server, server)?.location, null);
});
test('widgets reject untrusted pages, malformed locations, units, and servers', () => {
  for (const [raw, page, origin] of [
    [message(), 'https://elsewhere.ts.net', server], ['{', server, server],
    [message({ ...location, latitude: 91 }), server, server],
    [message({ ...location, timezone: 'No/SuchZone' }), server, server],
    [message(location, 'kelvin'), server, server], [message(), 'http://localhost', 'http://localhost'],
    ['x'.repeat(8193), server, server],
  ]) assert.equal(widgetPreferences(raw!, page!, origin!), null);
});
test('preference bridge sends changes once, survives reinjection, and preserves storage writes', () => {
  class Storage {
    data = new Map<string, string>();
    getItem(key: string) { return this.data.get(key) ?? null; }
    setItem(key: string, value: string) { this.data.set(key, value); }
  }
  const storage = new Storage(), messages: string[] = [];
  storage.setItem('zindycast.preferences.v1', JSON.stringify({ selected: location, units: 'us' }));
  const window = { ReactNativeWebView: { postMessage: (value: string) => messages.push(value) }, addEventListener() {} };
  const context = vm.createContext({ window, Storage, localStorage: storage, document: { addEventListener() {} } });
  vm.runInContext(widgetBridgeScript(), context);
  vm.runInContext(widgetBridgeScript(), context);
  assert.equal(messages.length, 1);
  storage.setItem('other', 'preserved');
  storage.setItem('zindycast.preferences.v1', JSON.stringify({ selected: null, units: 'metric' }));
  assert.equal(messages.length, 2);
  assert.equal(storage.getItem('other'), 'preserved');
  assert.equal(JSON.parse(messages[1]!).preferences.selected, null);
});
