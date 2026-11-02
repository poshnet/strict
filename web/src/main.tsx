import { applyTheme } from './lib/theme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { ToastProvider } from './lib/toast';
import { WalletProvider } from './lib/wallet';
import Home from './pages/Home';
import './styles/app.css';

applyTheme();

const Launch = lazy(() => import('./pages/Launch'));
const CoinPage = lazy(() => import('./pages/Coin'));
const Rules = lazy(() => import('./pages/Rules'));
const Kols = lazy(() => import('./pages/Kols'));
const Kol = lazy(() => import('./pages/Kol'));
const Check = lazy(() => import('./pages/Check'));
const Proof = lazy(() => import('./pages/Proof'));
const Analytics = lazy(() => import('./pages/Analytics'));
const NotFound = lazy(() => import('./pages/NotFound'));

// A deploy replaces the hashed chunks. A page still holding the old index can't load a lazy page any more: reload once,
// onto the new deploy, instead of showing a broken page (once per tab, so a real outage doesn't loop).
window.addEventListener('vite:preloadError', (e) => {
  try { if (sessionStorage.getItem('strict:reloaded')) return; sessionStorage.setItem('strict:reloaded', '1'); } catch { return; }
  e.preventDefault();
  location.reload();
});

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 3_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <WalletProvider>
          <BrowserRouter>
            <Shell>
              <Suspense fallback={<div className="page-load"><Spinner size={22} /></div>}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/launch" element={<Launch />} />
                  <Route path="/coin/:mint" element={<CoinPage />} />
                  <Route path="/rules" element={<Rules />} />
                  <Route path="/how" element={<Navigate to="/rules" replace />} />
                  <Route path="/kols" element={<Kols />} />
                  <Route path="/kol/:id" element={<Kol />} />
                  <Route path="/check" element={<Check />} />
                  <Route path="/proof" element={<Proof />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/:mint" element={<MintRoute />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Shell>
          </BrowserRouter>
        </WalletProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

/** strict.fun/<mint>: a coin's page at its bare address; anything else there is a 404 */
function MintRoute() {
  const { mint = '' } = useParams();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? <CoinPage /> : <NotFound />;
}
