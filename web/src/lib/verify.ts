// Checking a coin's list without trusting this site: the browser asks a public Solana RPC for the coin's curve (owned
// by the program, tied to the mint), reads the list hash the program stored when it sealed the list, hashes the wallets
// this page shows, and compares. It also reads whether the program itself can still be upgraded.
import { b58decode, b58encode } from './b58';

// public mainnet RPCs, unless the site names its own (config.publicRpc: a devnet or local validator)
const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const rpcsFor = (own?: string | null) => (own ? [own] : RPCS);

async function rpc(method: string, params: unknown[], own?: string | null) {
  let last: unknown;
  for (const url of rpcsFor(own)) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const cmp = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export type Verdict = { ok: boolean; onChainHash: string; pageHash: string; blocked: number; count: number; program: { upgradeable: boolean; authority: string | null } | null; rpc: string };

export async function verifyList(o: { programId: string; mint: string; curve: string; wallets: string[]; rpc?: string | null }): Promise<Verdict> {
  const info = await rpc('getAccountInfo', [o.curve, { encoding: 'base64', commitment: 'confirmed' }], o.rpc);
  if (!info?.value) throw new Error("The coin's curve isn't on chain.");
  if (info.value.owner !== o.programId) throw new Error("That account isn't owned by the strict.fun program.");
  const d = bytesOf(info.value.data[0]);
  if (b58encode(d.subarray(8, 40)) !== o.mint) throw new Error("That curve is for a different mint.");
  const view = new DataView(d.buffer, d.byteOffset);
  const blocked = view.getUint32(140, true);
  const onChainHash = hex(d.subarray(144, 176));
  const sorted = [...new Set(o.wallets)].map(b58decode).sort(cmp);
  const buf = new Uint8Array(sorted.length * 32);
  sorted.forEach((w, i) => buf.set(w, i * 32));
  const pageHash = blocked === 0 && sorted.length === 0 ? '0'.repeat(64) : hex(await crypto.subtle.digest('SHA-256', buf));

  // the program: an upgradeable program's data account names its upgrade authority (or none, once made final)
  let program: Verdict['program'] = null;
  try {
    const p = await rpc('getAccountInfo', [o.programId, { encoding: 'base64' }], o.rpc);
    const pd = bytesOf(p.value.data[0]);
    const dataAddr = b58encode(pd.subarray(4, 36));
    const dd = await rpc('getAccountInfo', [dataAddr, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } }], o.rpc);
    const b = bytesOf(dd.value.data[0]);
    const has = b[12] === 1;
    program = { upgradeable: has, authority: has ? b58encode(b.subarray(13, 45)) : null };
  } catch { /* not fatal */ }
  return { ok: onChainHash === pageHash && blocked === sorted.length, onChainHash, pageHash, blocked, count: sorted.length, program, rpc: rpcsFor(o.rpc)[0] };
}

export type ProgramStatus = { deployed: boolean; bytes: number | null; rentSol: number | null; slot: number | null; upgradeable: boolean; authority: string | null };

/** The program as the chain has it: deployed or not, its size and rent, the slot it was last deployed at, who can upgrade it. */
export async function programStatus(programId: string, own?: string | null): Promise<ProgramStatus> {
  const p = await rpc('getAccountInfo', [programId, { encoding: 'base64' }], own);
  if (!p?.value) return { deployed: false, bytes: null, rentSol: null, slot: null, upgradeable: false, authority: null };
  const dataAddr = b58encode(bytesOf(p.value.data[0]).subarray(4, 36));
  const d = await rpc('getAccountInfo', [dataAddr, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } }], own);
  const head = bytesOf(d.value.data[0]);
  const view = new DataView(head.buffer, head.byteOffset);
  const has = head[12] === 1;
  const lamports = Number(d.value.lamports);
  const space = typeof d.value.space === 'number' ? d.value.space : Math.round(lamports / 6960) - 128;
  return { deployed: true, bytes: space - 45, rentSol: lamports / 1e9, slot: Number(view.getBigUint64(4, true)), upgradeable: has, authority: has ? b58encode(head.subarray(13, 45)) : null };
}
