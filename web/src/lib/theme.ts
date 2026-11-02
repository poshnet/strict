// The theme lives in styles/app.css (Signal: near-black, amber, Sora and JetBrains Mono). This keeps the browser's
// toolbar colour in step with it, and lets canvas drawing (the chart) read its colours.
export function applyTheme() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0A0A0B');
}

/** a CSS variable's value right now (for canvas drawing, like the chart) */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
