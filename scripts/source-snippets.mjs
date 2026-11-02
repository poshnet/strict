// The code behind each rule, cut straight from the program (and, for no vamps, the worker) into web/src/lib/source.json,
// so the site's "Show the code" panels quote the source that is built and deployed, line numbers and all. Run after any
// change to the program: npm run snippets (the build runs it too).
import { readFileSync, writeFileSync } from 'node:fs';

const LIB = 'program/programs/strict/src/lib.rs';
const VAMP = 'worker/vamp.js';
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n');

/** the line index holding `anchor` (exactly one), or [scope, anchor]: the first `anchor` after the line holding `scope` */
function find(lines, anchor, file) {
  if (Array.isArray(anchor)) {
    const from = find(lines, anchor[0], file);
    const i = lines.findIndex((l, j) => j > from && l.includes(anchor[1]));
    if (i < 0) throw new Error(`${file}: "${anchor[1]}" not found after "${anchor[0]}"`);
    return i;
  }
  const at = lines.flatMap((l, i) => (l.includes(anchor) ? [i] : []));
  if (at.length !== 1) throw new Error(`${file}: "${anchor}" found ${at.length} times`);
  return at[0];
}

/** from `anchor` (pulling in the comment lines right above it) to the line that closes the brace it opens */
function block(lines, anchor, file, { comments = true, oneLine = false, count = 0 } = {}) {
  let start = find(lines, anchor, file);
  let end = start;
  if (count) end = start + count - 1;
  else if (!oneLine) {
    let depth = 0, opened = false;
    for (let i = start; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') { depth++; opened = true; } else if (ch === '}') depth--; }
      if (opened && depth <= 0) { end = i; break; }
    }
  }
  if (comments) while (start > 0 && /^\s*\/\/[/!]?/.test(lines[start - 1])) start--;
  return { start: start + 1, code: lines.slice(start, end + 1).join('\n') };
}

const lib = read(LIB);
const vamp = read(VAMP);
const rs = (anchor, o) => ({ file: LIB, ...block(lib, anchor, LIB, o) });
const js = (anchor, o) => ({ file: VAMP, ...block(vamp, anchor, VAMP, o) });

const out = {
  // fn buy's first lines, above its checks (the site's hero editor)
  head: [rs('fn buy(a: &[AccountInfo], sol_in: u64, min_out: u64)', { count: 4, comments: false })],
  kols: [rs('if c.blocked > 0 {'), rs('fn listed(list: &AccountInfo, who: &Pubkey)')],
  snipers: [rs('let f = if x.user.key == &c.creator', { oneLine: true }), rs('pub fn fee_now(c: &Curve, t: i64) -> u64 {')],
  dev: [rs('if c.no_dev_buy {', { oneLine: true })],
  bundles: [rs('if c.no_bundles {', { oneLine: true })],
  maxWallet: [rs('if c.max_wallet_bps > 0 {', { oneLine: true })],
  vamps: [js('export function vampKey(s) {'), js('export async function vampCheck(env, c,')],
  // the lock: create seals the list, and nothing can write to a sealed one
  lock: [rs(['fn create(a: &[AccountInfo]', 'if list.owner == &crate::ID && !list.data_is_empty() {'], { comments: false }),
    rs(['fn add_to_list(a: &[AccountInfo]', 'ok(!l.sealed, E::Sealed)?;'], { oneLine: true, comments: false })],
  // "How is this possible?": the rules written into the coin, every instruction the program has, and nobody minting more
  howStore: [rs(['fn create(a: &[AccountInfo]', 'let c = Curve {'], { comments: false })],
  howIx: [rs('match d {', { comments: false })],
  howMint: [rs('ok(m.no_mint_authority && m.no_freeze_authority, E::MintAuthority)?;', { oneLine: true, comments: false }),
    rs('ok(t.amount == g.p.token_supply, E::MintSupply)?;', { oneLine: true, comments: false })],
};
writeFileSync(new URL('../web/src/lib/source.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.map((b) => `${b.file.split('/').pop()}:${b.start}`).join(', ')}`).join('\n'));
