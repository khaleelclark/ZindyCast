import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CitySearch } from './city-search';

test('city search starts with labeled native search input and polite status, without fabricated locations', () => {
  const html = renderToStaticMarkup(React.createElement(CitySearch, { onSelect: () => assert.fail('No automatic selection') }));
  assert.match(html, /type="search"/);
  assert.match(html, /id="city-search"/);
  assert.match(html, /Search cities/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /class="search-results"/);
});
