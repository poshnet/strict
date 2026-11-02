// The KOL directory: every wallet kolscan (pump.fun's KOL tracker) names, with the KOL's X followers and picture
// (scripts/kols.mjs builds data/kols.json; the pictures are static files under /kols/). One KOL can trade from several
// wallets, so the directory is grouped by X handle, and a list counts each KOL's reach once.
import data from '../data/kols.json';

export const KOLS = data.kols;
export const KOLS_UPDATED = data.updated;
const byWallet = new Map(KOLS.map((k) => [k.wallet, k]));

/** one entry a KOL (by handle, else by wallet): their wallets, most followed first */
export const PEOPLE = (() => {
  const m = new Map();
  for (const k of KOLS) {
    const id = (k.handle || k.wallet).toLowerCase();
    const p = m.get(id) || { id, name: k.name, handle: k.handle, followers: k.followers, verified: k.verified, pfp: k.pfp, telegram: k.telegram, wallets: [] };
    p.wallets.push(k.wallet);
    if (!p.pfp && k.pfp) p.pfp = k.pfp;
    m.set(id, p);
  }
  return [...m.values()].sort((a, b) => b.followers - a.followers || a.name.localeCompare(b.name));
})();
const personById = new Map(PEOPLE.map((p) => [p.id, p]));

export const kolOf = (wallet) => byWallet.get(wallet) || null;
export const personOf = (wallet) => { const k = byWallet.get(wallet); return k ? personById.get((k.handle || k.wallet).toLowerCase()) : null; };
export const personById_ = (id) => personById.get(String(id).toLowerCase()) || null;

/** A list's KOLs, each once, most followed first, and the reach (followers) they add up to. */
export function listKols(wallets) {
  const seen = new Map();
  for (const w of wallets) {
    const p = personOf(w);
    if (p && !seen.has(p.id)) seen.set(p.id, p);
  }
  const people = [...seen.values()].sort((a, b) => b.followers - a.followers);
  return { people, wallets: wallets.filter((w) => byWallet.has(w)).length, reach: people.reduce((s, p) => s + p.followers, 0) };
}

/** the slim form the pages show */
export const card = (p) => p && ({ id: p.id, name: p.name, handle: p.handle, followers: p.followers, verified: p.verified, pfp: p.pfp, wallets: p.wallets });
