// Frame-accurate capture of jargon-portal-demo.html.
//   node capture.mjs                       -> renders demo.raw.mp4 (video only) via ffmpeg pipe
//   node capture.mjs --smoke 1000,5000,... -> writes _smoke/f_<t>.png for visual review
// Determinism: every frame is window.__seek(t); no wall-clock animation.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FPS = Number(process.env.FPS || 30);
const SCALE = Number(process.env.DSF || 1);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = process.env.OUT || path.join(DIR, 'demo.raw.mp4');

const args = process.argv.slice(2);
const smokeIdx = args.indexOf('--smoke');
const smoke = smokeIdx >= 0 ? args[smokeIdx + 1].split(',').map(Number) : null;

// --- tiny static server so the <link> to fonts.embed.css resolves cleanly in headless ---
const CT = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/jargon-portal-demo.html';
  const fp = path.join(DIR, f);
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': CT[path.extname(fp)] || 'application/octet-stream' });
    res.end(d);
  });
});

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/jargon-portal-demo.html`;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  const DURATION = await page.evaluate('window.__duration');

  if (smoke) {
    const sd = path.join(DIR, '_smoke');
    fs.mkdirSync(sd, { recursive: true });
    for (const t of smoke) {
      await page.evaluate(ms => window.__seek(ms), t);
      await page.waitForTimeout(40);
      await page.screenshot({ path: path.join(sd, `f_${t}.png`), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log('smoke frame', t);
    }
    await browser.close(); server.close();
    console.log('smoke frames ->', sd);
    return;
  }

  const totalFrames = Math.round((DURATION / 1000) * FPS);
  const ff = spawn(FFMPEG, [
    '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  console.log(`rendering ${totalFrames} frames @ ${FPS}fps -> ${OUT}`);
  for (let f = 0; f < totalFrames; f++) {
    const t = (f * 1000) / FPS;
    await page.evaluate(ms => window.__seek(ms), t);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`  frame ${f}/${totalFrames}  (t=${(t / 1000).toFixed(1)}s)`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => { ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))); });
  await browser.close(); server.close();
  console.log('video-only render complete ->', OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
