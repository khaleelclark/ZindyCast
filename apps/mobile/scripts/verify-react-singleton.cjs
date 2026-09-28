const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mobile = path.resolve(__dirname, '..');
const config = require('../metro.config.js');
const reactManifest = require.resolve('react/package.json', { paths: [mobile] });
assert.equal(JSON.parse(fs.readFileSync(reactManifest, 'utf8')).version, '19.2.3');
for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react/compiler-runtime']) {
  const target = config.resolver.resolveRequest({
    originModulePath: path.resolve(mobile, '../../node_modules/react-native/index.js'),
    resolveRequest: (_context, resolved) => resolved,
  }, name, 'android');
  assert.ok(target.startsWith(path.dirname(reactManifest) + path.sep), target);
}
const output = path.join(mobile, 'dist/_expo/static/js/android');
const maps = fs.readdirSync(output).filter(file => file.endsWith('.map'));
assert.ok(maps.length, 'Export Android with --source-maps before verifying.');
for (const file of maps) {
  const map = JSON.parse(fs.readFileSync(path.join(output, file), 'utf8'));
  const sources = map.sources.filter(source => /(?:^|\/)react\//.test(source));
  assert.ok(sources.length, 'Expected React modules in bundle source map.');
  for (const source of sources) assert.match(source, /(?:^|\/)apps\/mobile\/node_modules\/react\//, `Unexpected second React: ${source}`);
  console.log(`Verified React 19.2.3 singleton: ${sources.length} React sources in ${file}`);
}
