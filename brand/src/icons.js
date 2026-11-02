// The rules' icons (stroke SVG, 24 x 24), the same set the site uses.
const ICONS = {
  kols: '<path d="M3 10v4h3l5 4V6l-5 4H3z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  snipers: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  dev: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  bundles: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
  maxWallet: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  vamps: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
};
const RULES = [
  { id: 'kols', name: 'No KOLs', line: '562 KOL wallets can’t buy until it bonds' },
  { id: 'snipers', name: 'No snipers', line: 'First seconds cost up to 99% in fees' },
  { id: 'dev', name: 'No dev buy', line: 'The creator can’t buy before it bonds' },
  { id: 'bundles', name: 'No bundles', line: 'Nothing buys in the launch block' },
  { id: 'maxWallet', name: 'Max wallet 2%', line: 'No whale over 2% before it bonds' },
  { id: 'vamps', name: 'No vamps', line: 'No copycats of its name or picture' },
];
const icon = (k, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[k]}</svg>`;
