// A tiny timeline for frame-exact renders: render(t) places everything from t alone, so any frame comes out the same
// however it's captured. window.TOTAL is the length in seconds.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** progress of t through [a, b], 0..1 */
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => 1 - Math.pow(1 - x, 3);           // out-cubic
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const back = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
/** fade/slide an element in over [a, a+d] and out over [b, b+d2] */
function show(el, t, a, b = Infinity, { d = 0.45, d2 = 0.35, y = 18, x = 0, s = 1 } = {}) {
  const i = ease(seg(t, a, a + d)), o = ease(seg(t, b, b + d2));
  const v = i * (1 - o);
  el.style.opacity = v;
  el.style.transform = `translate(${x * (1 - i)}px, ${y * (1 - i) - y * 0.6 * o}px) scale(${s + (1 - s) * i})`;
  el.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
  return v;
}
const $ = (id) => document.getElementById(id);
/** the switch inside el, on by p (0..1) */
function flip(el, p, on = '#5B9BFF') {
  const sw = el.querySelector('.switch'), knob = sw.querySelector('i');
  knob.style.transform = `translateX(${18 * ease(p)}px)`;
  sw.style.background = p > 0.5 ? on : '#2F353E';
}
const count = (from, to, p, dp = 0) => (from + (to - from) * ease(p)).toFixed(dp);
