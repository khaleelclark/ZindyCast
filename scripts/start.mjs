// npm start serves the built app. The caller's environment overrides .env.
process.env.SERVE_WEB = '1';
await import('../apps/api/src/server.ts');
