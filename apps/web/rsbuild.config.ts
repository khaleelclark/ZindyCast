import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
const { publicVars, rawPublicVars } = loadEnv();
const mapboxToken = rawPublicVars.PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? '';
if (mapboxToken && (!/^pk\.[A-Za-z0-9_.-]+$/.test(mapboxToken) || mapboxToken.length > 2048)) throw new Error('PUBLIC_MAPBOX_ACCESS_TOKEN must be a public pk token. Secret or malformed tokens must not enter a browser build.');
export default defineConfig({ source: { define: { ...publicVars, 'process.env.PUBLIC_MAPBOX_ACCESS_TOKEN': JSON.stringify(mapboxToken) } }, plugins: [pluginReact()], output: { copy: ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'LICENSE.txt'].map(name => ({ from: `../../node_modules/maplibre-gl/${name === 'LICENSE.txt' ? name : 'dist/' + name}`, to: `vendor/maplibre-6.9.0/${name}` })) }, html: { template: './index.html', title: 'ZindyCast — Weather beyond temperature', tags: [{tag:'link',attrs:{rel:'manifest',href:'/manifest.webmanifest'}},{tag:'meta',attrs:{name:'theme-color',content:'#234e47'}}] }, server: { host: '127.0.0.1', port: 4310, proxy: { '/api': 'http://127.0.0.1:4311' } } });
