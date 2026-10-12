// Offline documentation checks. Never reads runtime config/databases or fetches providers.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const excluded = new Set(['node_modules', '.git', '.expo', 'android', 'dist', 'var', 'backups']);
function markdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdown(path) : entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}
const docs = ['README.md', 'SECURITY.md', 'AGENTS.md'].map(p => resolve(root, p));
for (const directory of ['docs', 'deploy', 'apps/mobile', 'packages/heat/reference', 'releases/android']) docs.push(...markdown(resolve(root, directory)));
const upstream = 'docs/verification/librewxr-trial/readme-upstream.md';
const failures = [], historicalImageLinks = [];
let links = 0;
function anchors(path) {
  const seen = new Map();
  return new Set([...readFileSync(path, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => {
    const slug = match[1].trim().toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }));
}
for (const file of docs) {
  const name = relative(root, file);
  if (name === upstream) continue; // Byte-preserved upstream evidence; links belong to its repository.
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('/api/')) continue;
    const [rawPath, hash] = target.split('#', 2);
    const localPath = decodeURIComponent(rawPath.split('?', 1)[0]);
    const resolved = localPath ? resolve(localPath.startsWith('/') ? root : dirname(file), localPath.replace(/^\//, '')) : file;
    links++;
    const line = source.slice(0, match.index).split('\n').length;
    if (!existsSync(resolved)) failures.push({ file: name, line, target, problem: 'missing local target' });
    else if (hash && extname(resolved) === '.md' && !anchors(resolved).has(decodeURIComponent(hash))) failures.push({ file: name, line, target, problem: 'missing heading anchor' });
    if (/^docs\/(verification|reviews)\/.+\.png$/.test(relative(root, resolved))) historicalImageLinks.push({ file: name, target });
  }
}
const current = ['README.md', 'SECURITY.md', 'docs/README.md', 'docs/status.md', 'docs/operations/README.md', 'deploy/README.md', 'apps/mobile/README.md'];
let shellBlocks = 0;
for (const name of current) {
  for (const match of readFileSync(resolve(root, name), 'utf8').matchAll(/```(?:sh|bash)\n([\s\S]*?)\n```/g)) {
    shellBlocks++;
    const checked = spawnSync('bash', ['-n'], { input: match[1], encoding: 'utf8' });
    if (checked.status !== 0) failures.push({ file: name, problem: 'shell syntax', detail: checked.stderr.trim() });
  }
}
const mobile = JSON.parse(readFileSync(resolve(root, 'apps/mobile/package.json')));
const expo = JSON.parse(readFileSync(resolve(root, 'apps/mobile/app.json'))).expo;
if (mobile.version !== expo.version) failures.push({ problem: 'mobile manifest version mismatch' });
for (const name of ['README.md', 'apps/mobile/README.md', 'docs/status.md']) {
  if (!readFileSync(resolve(root, name), 'utf8').includes(expo.version)) failures.push({ file: name, problem: 'current Android version absent' });
}
const release = JSON.parse(readFileSync(resolve(root, 'docs/verification/android-widgets/apks.json')));
if (release.length !== 2 || release.some(item => !item.file.includes(expo.version) || !/^[a-f0-9]{64}$/.test(item.sha256) || !(item.bytes > 0))) failures.push({ problem: 'widget release manifest invalid' });
const releaseDirectory = resolve(root, 'releases/android', expo.version);
const checksumsPath = resolve(releaseDirectory, 'SHA256SUMS');
const checksums = existsSync(checksumsPath) ? readFileSync(checksumsPath, 'utf8') : '';
for (const item of release) {
  const path = resolve(releaseDirectory, item.file);
  if (!existsSync(path)) failures.push({ file: relative(root, path), problem: 'current APK missing' });
  else {
    const bytes = readFileSync(path);
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) failures.push({ file: relative(root, path), problem: 'APK differs from release manifest' });
  }
  if (!checksums.split('\n').includes(`${item.sha256}  ${item.file}`)) failures.push({ file: relative(root, checksumsPath), problem: `missing checksum for ${item.file}` });
}
for (const name of ['.env.example', 'deploy/runtime.env.example']) {
  const source = readFileSync(resolve(root, name), 'utf8');
  for (const key of ['ZINDYCAST_DB_PATH', 'ZINDYCAST_JOBS_PATH', 'ZINDYCAST_INSTALLATIONS_PATH', 'ZINDYCAST_NOTIFICATIONS_PATH', 'ZINDYCAST_VERIFICATION_PATH', 'ZINDYCAST_WET_BULB_TRACKER_PATH']) {
    if (!new RegExp(`^${key}=`, 'm').test(source)) failures.push({ file: name, problem: `missing documented database configuration ${key}` });
  }
}
const result = { date: new Date().toISOString(), markdownFiles: docs.length, checkedLocalLinks: links, checkedCurrentShellBlocks: shellBlocks, androidVersion: expo.version, androidVersionCode: expo.android.versionCode, failures, historicalImageLinks, excludedUpstreamSnapshot: upstream, scope: 'Offline local links/anchors, shell syntax, release metadata and environment keys. No command execution, external-link availability, runtime restore or device verification.' };
if (process.argv.includes('--write')) writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, historicalImageLinks: historicalImageLinks.length }, null, 2));
process.exitCode = failures.length ? 1 : 0;
