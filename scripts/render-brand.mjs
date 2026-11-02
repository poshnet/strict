// Renders strict.fun's brand from brand/src (HTML, placed frame by frame by each page's render(t)):
//   brand/pfp.png        X profile picture, 400 x 400 at 2x
//   brand/banner.png     X header, 1500 x 500 at 2x
//   brand/og.png         the link card, 1200 x 630 (also web/public/og.jpg, the one index.html points at)
//   brand/teaser-graphic.png (1600 x 900) and teaser-graphic-square.png (1200 x 1200), at 2x: everything, in one card
//   web/public/apple-touch-icon.png (180) and icon-512.png
//   brand/teaser.mp4/.gif         the teaser, 1920 x 1080 at 30 fps (silent; gif 800 wide at 20 fps)
//   brand/teaser-live.mp4/.gif    the same with a "live now" end card
//   brand/launch.mp4/.gif         the launch video
//   brand/warmup.mp4/.gif         the warm-up (pre-launch): the replies every launch gets, then one bold card per rule
//   brand/warmup-ad.mp4/.gif      the warm-up as a square ad (1080 x 1080): a pump-and-dump hook, punchy cards, the product
//   brand/explainer.gif/.mp4      the explainer for X: four launches dying four ways, the rules at work on a coin page
//   brand/brings.gif/.mp4         "what strict.fun brings": the eight points ticking on, each with the program's proof
// The faint code behind the art, and the snippets the teaser shows, come from the program itself (code.js, written
// here from program/programs/strict/src/lib.rs and web/src/lib/source.json).
// Needs Chrome, ffmpeg and gifski on PATH, and puppeteer-core (PUPPETEER=<its entry>, default: the copy in ~/Documents/clawd).
//   node scripts/render-brand.mjs [pfp|banner|og|graphic|icon|teaser|live|launch|warmup|ad|explainer|brings|stills|videos|all]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const puppeteer = (await import(process.env.PUPPETEER || '/Users/hunr/Documents/clawd/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const what = process.argv[2] || 'all';
const want = (k, group) => what === 'all' || what === k || what === group;
const src = resolve('brand/src');
const out = resolve('brand');
const pub = resolve('web/public');

// code.js: fn buy and fee_now as they are in the program, and the per-rule snippets
const lib = readFileSync('program/programs/strict/src/lib.rs', 'utf8');
const fnAt = (sig) => { const i = lib.indexOf(sig); const j = lib.indexOf('\n}\n', i); return lib.slice(i, j + 2); };
const CODE = `${fnAt('fn buy(a: &[AccountInfo]')}\n${fnAt('pub fn fee_now(')}\n${fnAt('fn listed(list: &AccountInfo')}\n`;
const SNIPPETS = JSON.parse(readFileSync('web/src/lib/source.json', 'utf8'));
writeFileSync(join(src, 'code.js'), `// written by scripts/render-brand.mjs from the program source\nwindow.CODE = ${JSON.stringify(CODE)};\nwindow.SNIPPETS = ${JSON.stringify(SNIPPETS)};\n`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
async function open(file, width, height, scale) {
  await page.goto('about:blank');
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.goto(`file://${join(src, file)}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
}
const done = (f) => console.log(f.replace(`${resolve('.')}/`, ''));

if (want('pfp', 'stills')) { await open('pfp.html', 400, 400, 2); await page.screenshot({ path: join(out, 'pfp.png') }); done(join(out, 'pfp.png')); }
if (want('banner', 'stills')) { await open('banner.html', 1500, 500, 2); await page.screenshot({ path: join(out, 'banner.png') }); done(join(out, 'banner.png')); }
if (want('og', 'stills')) {
  await open('og.html', 1200, 630, 1);
  await page.screenshot({ path: join(out, 'og.png') });
  await page.screenshot({ path: join(pub, 'og.jpg'), type: 'jpeg', quality: 92 });
  done(join(out, 'og.png')); done(join(pub, 'og.jpg'));
}
if (want('graphic', 'stills')) {
  // the teaser graphic: X's 16:9 card, and a square for feeds that crop
  await open('teaser-graphic.html', 1600, 900, 2); await page.screenshot({ path: join(out, 'teaser-graphic.png') }); done(join(out, 'teaser-graphic.png'));
  await open('teaser-graphic.html#square', 1200, 1200, 2); await page.screenshot({ path: join(out, 'teaser-graphic-square.png') }); done(join(out, 'teaser-graphic-square.png'));
}
if (want('icon', 'stills')) {
  for (const [size, name] of [[180, 'apple-touch-icon.png'], [512, 'icon-512.png']]) {
    await open('icon.html', size, size, 1);
    await page.screenshot({ path: join(pub, name) });
    done(join(pub, name));
  }
}

async function video(file, name, w = 1200, h = 675, scale = 1.6, gifOpt = {}) {
  const g = { fps: 20, width: 800, quality: 88, ...gifOpt };
  await open(file, w, h, scale);
  const total = await page.evaluate(() => window.TOTAL);
  const fps = 30;
  const frames = join(tmpdir(), `strict-${name}-${Date.now()}`);
  mkdirSync(frames, { recursive: true });
  const n = Math.round(total * fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), i / fps);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
    if (i % 90 === 0) console.log(`${name}: frame ${i}/${n}`);
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
  done(join(out, `${name}.mp4`));
  const gif = [];
  for (let i = 0; i < n; i += fps / g.fps) gif.push(join(frames, `f${String(Math.min(n - 1, Math.round(i))).padStart(4, '0')}.png`));
  execFileSync('gifski', ['--quiet', '--fps', String(g.fps), '--width', String(g.width), '--quality', String(g.quality), '-o', join(out, `${name}.gif`), ...gif.filter((f, k, a) => a.indexOf(f) === k)]);
  done(join(out, `${name}.gif`));
  rmSync(frames, { recursive: true, force: true });
}
if (want('teaser', 'videos')) await video('teaser.html', 'teaser');
if (want('live', 'videos')) await video('teaser.html#live', 'teaser-live');
if (want('launch', 'videos')) await video('launch.html', 'launch');
if (want('warmup', 'videos')) await video('warmup.html', 'warmup');
if (want('ad', 'videos')) await video('warmup-ad.html', 'warmup-ad', 1080, 1080, 1);
// the explainer is posted as a GIF, and X takes GIFs up to 15 MB: 15 fps at 960 wide lands around 10 MB
// the "what strict.fun brings" GIF, for the tweet of the same name: square, 15 fps at 800
if (want('brings', 'videos')) await video('brings.html', 'brings', 1080, 1080, 1, { fps: 15, width: 800, quality: 85 });
if (want('explainer', 'videos')) await video('explainer.html', 'explainer', 1200, 675, 1.6, { fps: 15, width: 960, quality: 85 });
await browser.close();
