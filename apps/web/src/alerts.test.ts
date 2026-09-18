import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentAlerts, officialLink, parseAlerts } from './alerts';
const location = { latitude: 38, longitude: -121 };
const alert = { id: 'test', event: 'Test warning', headline: null, severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', sent: '2026-09-11T00:00:00Z', effective: null, onset: null, expires: '2026-09-12T00:00:00Z', ends: null, status: 'Actual', messageType: 'Alert', description: 'Official\ntext', instruction: null, areaDesc: 'Test area', senderName: 'NWS', web: null, geometry: null, affectedZones: [] };
const response = { status: 'success', freshness: 'fresh', data: { coordinates: location, retrievedAt: '2026-09-11T01:00:00Z', provider: 'NWS', alerts: [alert], attribution: 'NWS' } };
test('alerts validate location, unavailable state and complete official text independently', () => {
  assert.equal(parseAlerts(response, location).data.alerts[0]!.description, 'Official\ntext');
  assert.throws(() => parseAlerts(response, { ...location, latitude: 39 }), /match/);
  assert.throws(() => parseAlerts({ status: 'error', code: 'not_configured', message: 'missing key' }, location), /not configured/);
  assert.throws(() => parseAlerts({ ...response, data: { ...response.data, retrievedAt: 'invalid' } }, location));
  assert.deepEqual(parseAlerts({ ...response, data: { ...response.data, alerts: [] } }, location).data.alerts, []);
});
test('expired, ended, test and cancellation records never appear as current alerts', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  assert.deepEqual(currentAlerts([alert, { ...alert, id: 'cancel', messageType: 'Cancel' }, { ...alert, id: 'test', status: 'Test' }, { ...alert, id: 'expired', expires: new Date(now).toISOString() }, { ...alert, id: 'ended', ends: new Date(now).toISOString() }], now).map(a => a.id), ['test']);
  assert.equal(currentAlerts([alert], Date.parse(alert.expires)).length, 0);
});
test('official links only navigate to HTTPS NWS domains', () => {
  assert.equal(officialLink('https://alerts.weather.gov/test'), 'https://alerts.weather.gov/test');
  for (const value of [null, 'javascript:alert(1)', 'https://weather.gov.evil.test/', 'http://weather.gov/']) assert.equal(officialLink(value), 'https://www.weather.gov/');
});
