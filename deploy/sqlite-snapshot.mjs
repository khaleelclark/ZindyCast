import { DatabaseSync, backup } from 'node:sqlite';
import { openSync, closeSync, rmSync, chmodSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// One consistent database snapshot. Call only in a trusted, private directory.
// Cross-database consistency requires stopping both application processes first.
export async function snapshot(source, destination) {
  if (resolve(source) === resolve(destination)) throw new Error('Distinct paths required');
  const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  let created = false;
  try {
    // A new main filename is insufficient if old SQLite sidecars remain.
    // Do not consume or remove a pre-existing sidecar (including a symlink).
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { lstatSync(destination + suffix); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error('Destination SQLite sidecar already exists');
    }
    closeSync(openSync(destination, 'wx', 0o600)); created = true;
    await backup(db, destination, { rate: 128 });
    const check = new DatabaseSync(destination, { readOnly: true, timeout: 5000 });
    try {
      const rows = check.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('Integrity check failed');
      if (check.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed');
    } finally { check.close(); }
    chmodSync(destination, 0o600);
  } catch (error) {
    if (created) for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(destination + suffix, { force: true });
    throw error;
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node deploy/sqlite-snapshot.mjs SOURCE NEW_DESTINATION');
  await snapshot(process.argv[2], process.argv[3]);
  console.log('SQLite snapshot verified');
}
