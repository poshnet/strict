// Grinds mint keypairs whose address ends in "fair" (or --suffix) and loads them into the D1 mint_pool, each secret encrypted with
// keys/VAULT_KEY.txt exactly as worker/crypto.js expects (AES-256-GCM, the address as additional data). Launches take
// one each; when the pool is empty a launch gets a random address.
//
//   node scripts/load-mints.mjs --count 50 [--suffix fair] [--local]     (4 letters: ~10 s a key on 8 threads)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';

const local = process.argv.includes('--local');
const count = Number(process.argv[process.argv.indexOf('--count') + 1]) || 0;
const suffix = process.argv.includes('--suffix') ? process.argv[process.argv.indexOf('--suffix') + 1] : 'fair';
const dir = 'keys/mints';
mkdirSync(dir, { recursive: true });
if (count > 0) execFileSync('solana-keygen', ['grind', '--ends-with', `${suffix}:${count}`, '--num-threads', '8'], { cwd: dir, stdio: 'inherit' });

const files = readdirSync(dir).filter((f) => f.endsWith(`${suffix}.json`));
if (!files.length) { console.log('no new mints in keys/mints'); process.exit(0); }
const raw = Buffer.from(readFileSync('keys/VAULT_KEY.txt', 'utf8').trim(), 'base64');
if (raw.length !== 32) throw new Error('VAULT_KEY must be 32 bytes');
const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);

const rows = [];
for (const f of files) {
  const address = f.replace(/\.json$/, '');
  const secret = Uint8Array.from(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  if (secret.length !== 64) throw new Error(`${f}: not a 64-byte keypair`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(address) }, key, secret));
  rows.push(`INSERT OR IGNORE INTO mint_pool (mint, secret) VALUES ('${address}', 'v1:${Buffer.concat([iv, ct]).toString('base64')}');`);
}
mkdirSync('node_modules/.cache', { recursive: true });
const sql = 'node_modules/.cache/mint-pool.sql';
writeFileSync(sql, rows.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'strict', local ? '--local' : '--remote', '--file', sql, '--yes'], { stdio: 'inherit' });
writeFileSync(sql, ''); // only encrypted secrets, but don't leave them around
if (!local) {
  mkdirSync(path.join(dir, 'loaded'), { recursive: true });
  for (const f of files) renameSync(path.join(dir, f), path.join(dir, 'loaded', f));
}
console.log(`loaded ${rows.length} mint${rows.length > 1 ? 's' : ''} into the ${local ? 'local' : 'remote'} pool`);
