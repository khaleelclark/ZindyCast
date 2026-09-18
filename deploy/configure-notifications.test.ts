import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createECDH } from 'node:crypto';

const script = fileURLToPath(new URL('./configure-notifications.mjs', import.meta.url));
function fixture(content: string, run: (path: string, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'zc-notification-setup-'));
  const path = join(dir, 'runtime.env');
  writeFileSync(path, content, { mode: 0o600 });
  try { run(path, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const invoke = (path: string) => spawnSync(process.execPath, [script, path], { encoding: 'utf8' });

test('setup requires an explicit canonical HTTPS origin and leaves invalid files untouched', () => {
  for (const origin of ['', 'http://weather.example.com', 'https://weather.example.com/', 'https://weather.example.com/path']) {
    const input = origin ? `ZINDYCAST_PUBLIC_ORIGIN=${origin}\n` : 'NODE_ENV=production\n';
    fixture(input, (path, dir) => {
      assert.notEqual(invoke(path).status, 0);
      assert.equal(readFileSync(path, 'utf8'), input);
      assert.deepEqual(readdirSync(dir), ['runtime.env']);
    });
  }
});

test('setup generates matching private keys for the supplied origin, replacing empty placeholders once', () => {
  const input = 'NODE_ENV=production\nZINDYCAST_PUBLIC_ORIGIN="https://weather.example.com:8443"\nZINDYCAST_VAPID_PUBLIC_KEY=\nZINDYCAST_VAPID_PRIVATE_KEY=\nZINDYCAST_VAPID_SUBJECT=\n';
  fixture(input, (path, dir) => {
    const result = invoke(path);
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(path, 'utf8');
    const values = Object.fromEntries(output.trim().split('\n').map(line => line.split('=')));
    assert.equal(values.ZINDYCAST_VAPID_SUBJECT, 'https://weather.example.com:8443');
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(values.ZINDYCAST_VAPID_PRIVATE_KEY!, 'base64url'));
    assert.equal(key.getPublicKey().toString('base64url'), values.ZINDYCAST_VAPID_PUBLIC_KEY);
    assert.equal(output.match(/^ZINDYCAST_VAPID_/gm)?.length, 3);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const backup = readdirSync(dir).find(name => name.includes('.before-notifications-'))!;
    assert.equal(readFileSync(join(dir, backup), 'utf8'), input);
    assert.equal(statSync(join(dir, backup)).mode & 0o777, 0o600);
    assert.ok(!result.stdout.includes(values.ZINDYCAST_VAPID_PRIVATE_KEY!));
    assert.equal(invoke(path).status, 0);
    assert.equal(readFileSync(path, 'utf8'), output);
    assert.equal(readdirSync(dir).length, 2);
  });
});

test('nonempty existing key configuration is never overwritten, even when partial', () => {
  const input = 'ZINDYCAST_VAPID_PUBLIC_KEY=existing-value\n';
  fixture(input, (path, dir) => {
    assert.equal(invoke(path).status, 0);
    assert.equal(readFileSync(path, 'utf8'), input);
    assert.deepEqual(readdirSync(dir), ['runtime.env']);
  });
});
