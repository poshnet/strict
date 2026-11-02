// Shared queries: the config (SOL's price, the curve), and the KOL directory the launch page and coin pages draw from.
import { useQuery } from '@tanstack/react-query';
import { api, type Config, type DirKol } from './api';

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });
export const useKols = () => useQuery({ queryKey: ['kols'], queryFn: api.kols, staleTime: 60_000 });

/** SOL -> USD with the live price (null while unknown) */
export function useUsd() {
  const { data } = useConfig();
  const p = data?.solUsd ?? null;
  return (sol: number | null | undefined) => (p == null || sol == null ? null : sol * p);
}

/** what a list of `n` wallets costs to store, in SOL (it buys the coin back once it bonds) */
export const listRentSol = (c: Config | undefined, n: number) => (!c || n <= 0 ? 0 : (c.listRent.base + c.listRent.perWallet * n) / 1e9);

export const followers = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
export const fullFollowers = (n: number) => n.toLocaleString('en-US');
export type { DirKol };
