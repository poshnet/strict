// Sets up the strict program's global settings (once per deployment), or updates them.
//
//   node --experimental-require-module scripts/init-program.mjs --rpc <url> [--update] [--paused]
//
// The authority is keys/deployer.json; the fee recipient is keys/fee-wallet.address.txt. Settings are DEFAULT_PARAMS
// in worker/program.js (the familiar launchpad curve shape, 1% fee, 1000-wallet lists).
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import * as P from '../worker/program.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const rpc = arg('--rpc') || 'http://127.0.0.1:8899';
const conn = new Connection(rpc, 'confirmed');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('../keys/deployer.json', import.meta.url)))));
const feeRecipient = new PublicKey(readFileSync(new URL('../keys/fee-wallet.address.txt', import.meta.url), 'utf8').trim());
const params = { ...P.DEFAULT_PARAMS, feeRecipient, paused: process.argv.includes('--paused') };

const exists = await conn.getAccountInfo(P.globalPda());
const update = process.argv.includes('--update');
if (exists && !update) {
  console.log('already initialized:', P.decodeGlobal(exists.data));
  process.exit(0);
}
const ix = exists ? P.setParamsIx(authority.publicKey, params) : P.initializeIx(authority.publicKey, params);
const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), ix);
const sig = await sendAndConfirmTransaction(conn, tx, [authority], { commitment: 'confirmed' });
console.log(exists ? 'updated' : 'initialized', sig);
console.log(P.decodeGlobal((await conn.getAccountInfo(P.globalPda())).data));
