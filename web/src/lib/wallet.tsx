// Wallets through the Wallet Standard (Phantom, Solflare, Backpack, Jupiter, OKX... all register with it). Transactions
// travel as bytes: the worker builds them, the wallet signs, so the page never needs web3.js. A launch's transactions
// are signed together in one approval; a trade is signed and sent by the wallet. Signing in (one message) is optional.
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken } from './api';
import { b58encode, b64ToBytes, bytesToB64 } from './b58';

const CHAIN = 'solana:mainnet';
const LAST = 'strict.wallet';
const SESSION = (a: string) => `strict.session.${a}`;

type Ctx = {
  wallets: Wallet[];
  wallet: Wallet | null;
  address: string | null;
  connecting: boolean;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  connect: (w: Wallet) => Promise<string | null>;
  disconnect: () => Promise<void>;
  ensure: () => Promise<string | null>;
  signIn: () => Promise<string>;
  signedIn: boolean;
  signAll: (b64s: string[]) => Promise<string[]>;
  signAndSend: (b64: string, lastValidBlockHeight?: number) => Promise<string>;
};
const WalletCtx = createContext<Ctx | null>(null);

const usable = (w: Wallet) => 'standard:connect' in w.features && 'solana:signTransaction' in w.features && w.chains.some((c) => c.startsWith('solana:'));
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let resolvePicker: ((a: string | null) => void) | null = null;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const reg = getWallets();
    const refresh = () => setWallets(reg.get().filter(usable));
    refresh();
    const offs = [reg.on('register', refresh), reg.on('unregister', refresh)];
    return () => offs.forEach((off) => off());
  }, []);

  // reconnect silently to the wallet used last time
  useEffect(() => {
    if (wallet) return;
    const last = store.get(LAST);
    const w = last && wallets.find((x) => x.name === last);
    if (!w) return;
    (async () => {
      try {
        const r = await (w.features['standard:connect'] as any).connect({ silent: true });
        const acct = r?.accounts?.[0] || w.accounts[0];
        if (acct) { setWallet(w); setAccount(acct); }
      } catch { /* not trusted yet */ }
    })();
  }, [wallets, wallet]);

  // follow account switches inside the wallet
  useEffect(() => {
    if (!wallet || !('standard:events' in wallet.features)) return;
    return (wallet.features['standard:events'] as any).on('change', (p: { accounts?: readonly WalletAccount[] }) => {
      if (p.accounts) { setAccount(p.accounts[0] || null); if (!p.accounts[0]) setWallet(null); }
    });
  }, [wallet]);

  useEffect(() => {
    const t = account ? store.get(SESSION(account.address)) : null;
    setToken(t);
    setSignedIn(!!t);
  }, [account]);

  const connect = useCallback(async (w: Wallet) => {
    setConnecting(true);
    try {
      const r = await (w.features['standard:connect'] as any).connect();
      const acct: WalletAccount | undefined = r?.accounts?.[0] || w.accounts[0];
      if (!acct) throw new Error('The wallet shared no account.');
      setWallet(w); setAccount(acct); store.set(LAST, w.name);
      setPickerOpen(false);
      resolvePicker?.(acct.address); resolvePicker = null;
      return acct.address;
    } finally { setConnecting(false); }
  }, []);

  const disconnect = useCallback(async () => {
    try { await (wallet?.features['standard:disconnect'] as any)?.disconnect(); } catch { /* ignore */ }
    store.set(LAST, null);
    setWallet(null); setAccount(null);
  }, [wallet]);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => { setPickerOpen(false); resolvePicker?.(null); resolvePicker = null; }, []);
  const ensure = useCallback(async () => {
    if (account) return account.address;
    setPickerOpen(true);
    return new Promise<string | null>((res) => { resolvePicker = res; });
  }, [account]);

  const signIn = useCallback(async () => {
    if (!wallet || !account) throw new Error('Connect a wallet first.');
    const have = store.get(SESSION(account.address));
    if (have) { setToken(have); return have; }
    const f = wallet.features['solana:signMessage'] as any;
    if (!f) throw new Error('This wallet cannot sign messages.');
    const { message } = await api.authMessage(account.address);
    const [r] = await f.signMessage({ account, message: new TextEncoder().encode(message) });
    const { token } = await api.authVerify(account.address, message, b58encode(r.signature));
    store.set(SESSION(account.address), token);
    setToken(token); setSignedIn(true);
    return token;
  }, [wallet, account]);

  /** every transaction signed in one approval, returned in order, unsent */
  const signAll = useCallback(async (b64s: string[]) => {
    if (!wallet || !account) throw new Error('Connect a wallet first.');
    const st = wallet.features['solana:signTransaction'] as any;
    const out = await st.signTransaction(...b64s.map((b) => ({ account, transaction: b64ToBytes(b), chain: CHAIN })));
    return out.map((o: { signedTransaction: Uint8Array }) => bytesToB64(o.signedTransaction));
  }, [wallet, account]);

  const signAndSend = useCallback(async (b64: string, lastValidBlockHeight?: number) => {
    if (!wallet || !account) throw new Error('Connect a wallet first.');
    const ss = wallet.features['solana:signAndSendTransaction'] as any;
    if (ss) {
      const [r] = await ss.signAndSendTransaction({ account, transaction: b64ToBytes(b64), chain: CHAIN, options: { skipPreflight: false, maxRetries: 5 } });
      return b58encode(r.signature);
    }
    const st = wallet.features['solana:signTransaction'] as any;
    const [o] = await st.signTransaction({ account, transaction: b64ToBytes(b64), chain: CHAIN });
    return (await api.send(bytesToB64(o.signedTransaction), lastValidBlockHeight)).signature;
  }, [wallet, account]);

  const value = useMemo<Ctx>(() => ({
    wallets, wallet, address: account?.address || null, connecting, pickerOpen, openPicker, closePicker, connect, disconnect, ensure, signIn, signedIn, signAll, signAndSend,
  }), [wallets, wallet, account, connecting, pickerOpen, openPicker, closePicker, connect, disconnect, ensure, signIn, signedIn, signAll, signAndSend]);
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const v = useContext(WalletCtx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

// A wallet's own error in one line ("User rejected the request" and friends).
export function walletError(e: unknown): string {
  const m = (e as any)?.message || String(e);
  if (/reject|denied|cancel|declined|closed/i.test(m)) return 'You cancelled in your wallet.';
  return m.length > 220 ? m.slice(0, 220) + '…' : m;
}
