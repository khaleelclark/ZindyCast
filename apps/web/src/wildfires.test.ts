import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseWildfires, perimeterMatches, sameWildfireBox, wildfireBox, WildfireEvidence, WildfirePanel } from './wildfires';
// Preserved September 11 evidence is used only in tests, never imported by the UI.
const data = JSON.parse(readFileSync(new URL('../../../docs/verification/wildfire/live-result.json', import.meta.url), 'utf8'));
const response = () => ({ status: 'success', freshness: 'fresh', data: structuredClone(data) });
const now = Date.parse('2026-09-11T02:00:00Z');
test('wildfire area is bounded, clamps poles/date line and compares exact selection', () => {
  assert.deepEqual(wildfireBox({ latitude: 90, longitude: 180 }), { west: 178, east: 180, south: 88, north: 90 });
  assert.deepEqual(wildfireBox({ latitude: -89, longitude: -179 }), { west: -180, east: -177, south: -90, north: -87 });
  const box = wildfireBox({ latitude: 65, longitude: -150 });
  assert.equal(box.east - box.west, 4); assert.equal(box.north - box.south, 4);
  assert.equal(sameWildfireBox(box, { ...box, north: 68 }), false);
  for (const latitude of [91, NaN, Infinity]) assert.throws(() => wildfireBox({ latitude, longitude: 0 }));
});
test('wildfire response guards bbox, timestamps, metadata and identity without name joins', () => {
  const parsed = parseWildfires(response(), data.bbox).data;
  assert.equal(perimeterMatches(parsed.incidents[0]!, parsed.perimeters).length, 1);
  assert.equal(perimeterMatches({ ...parsed.incidents[0]!, normalizedIrwinId: null }, parsed.perimeters).length, 0);
  assert.equal(perimeterMatches({ ...parsed.incidents[0]!, normalizedIrwinId: '00000000-0000-0000-0000-000000000000' }, parsed.perimeters).length, 0);
  assert.throws(() => parseWildfires(response(), { ...data.bbox, north: 67 }), /match/);
  const bad = response(); bad.data.perimeters[0].polygonCapturedAt.utc = bad.data.retrievedAt;
  assert.throws(() => parseWildfires(bad, data.bbox));
  const metadata = response(); metadata.data.sources.incidents.publishedRecords = 0;
  assert.throws(() => parseWildfires(metadata, data.bbox));
});
test('wildfire rendering separates capture/edit/incident/retrieval, geometry and category evidence', () => {
  const parsed = parseWildfires(response(), data.bbox).data;
  const html = renderToStaticMarkup(React.createElement(WildfireEvidence, { data: parsed, now }));
  for (const text of ['WF · Wildfire', 'Polygon captured', 'Edited:', 'Created:', parsed.retrievedAt, parsed.perimeters[0]!.polygonCapturedAt.utc!, parsed.perimeters[0]!.polygonUpdatedAt.utc!, parsed.incidents[0]!.incidentUpdatedAt.utc!, 'topology unverified', 'no perimeter overlay', 'latitude', 'matching IRWIN ID', 'over ten minutes old']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<svg')); assert.ok(!html.includes('<polygon'));
  for (const category of ['RX', 'CX', null]) {
    const raw = response(); raw.data.incidents[0].category = category; raw.data.incidents[0].geometry = null; raw.data.perimeters[0].geometry = null; raw.data.perimeters[0].polygonCapturedAt = { utc: null, epochMs: null };
    const rendered = renderToStaticMarkup(React.createElement(WildfireEvidence, { data: parseWildfires(raw, data.bbox).data, now }));
    for (const text of [category === 'RX' ? 'RX · Prescribed fire' : category === 'CX' ? 'CX · Incident complex' : 'Unknown source category', 'Location geometry unavailable', 'Geometry unavailable (source null)', 'Unknown (source null)']) assert.ok(rendered.includes(text), text);
  }
});
test('empty and initial/offline views do not claim all clear or load fixture data', () => {
  const raw = response(); raw.data.incidents = []; raw.data.perimeters = [];
  for (const kind of ['incidents', 'perimeters']) { raw.data.sources[kind].publishedRecords = 0; raw.data.sources[kind].availability = 'no_published_records'; }
  const html = renderToStaticMarkup(React.createElement(WildfireEvidence, { data: parseWildfires(raw, data.bbox).data, now }));
  assert.ok(html.includes('does not mean no fires or all clear')); assert.ok(html.includes('No perimeter does not mean no fire'));
  const initial = renderToStaticMarkup(React.createElement(WildfirePanel, { location: null, online: false, now }));
  for (const text of ['Load wildfire evidence', 'disabled', 'Choose a city', 'Offline', 'not evacuation zones']) assert.ok(initial.includes(text), text);
  assert.ok(!initial.includes('Canyon'));
});
