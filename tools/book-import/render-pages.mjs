// Render the selected book pages (pages.json) to JPEGs under frontend/public/books/,
// where the Render static site serves them at /books/<slug>/p<N>.jpg — the same
// relative URL the composed lessons reference. pdf.js draws in a real browser
// (vector line art needs a canvas, not an image decoder); an in-process static
// server feeds it the page, the library and the book.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [pdfPath, manifestPath, publicRoot] = [process.argv[2], process.argv[3], process.argv[4]];
const here = path.dirname(fileURLToPath(import.meta.url));
const pdfjsDir = path.join(here, "../../frontend/node_modules/pdfjs-dist/legacy/build");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const routes = {
      "/render.html": [path.join(here, "render.html"), "text/html"],
      "/lib/pdf.mjs": [path.join(pdfjsDir, "pdf.mjs"), "text/javascript"],
      "/lib/pdf.worker.mjs": [path.join(pdfjsDir, "pdf.worker.mjs"), "text/javascript"],
      "/book.pdf": [pdfPath, "application/pdf"],
    };
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": route[1] });
    res.end(await readFile(route[0]));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: 1300, height: 1700 } })).newPage();
await page.goto(`http://127.0.0.1:${port}/render.html`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", null, { timeout: 30000 });

let totalBytes = 0;
let count = 0;
for (const [slug, pages] of Object.entries(manifest.lessons)) {
  if (!pages.length) continue;
  const dir = path.join(publicRoot, "books", slug);
  await mkdir(dir, { recursive: true });
  for (const entry of pages) {
    const dims = await page.evaluate(
      ([u, n]) => window.__render(u, n, 2.0),
      [`http://127.0.0.1:${port}/book.pdf`, entry.page],
    );
    await page.setViewportSize({ width: Math.ceil(dims[0]), height: Math.ceil(dims[1]) });
    const out = path.join(dir, `p${entry.page}.jpg`);
    await page.locator("#c").screenshot({ path: out, type: "jpeg", quality: 70 });
    totalBytes += (await stat(out)).size;
    count += 1;
  }
}
await browser.close();
server.close();
console.log(`${count} pages -> ${publicRoot}/books  (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
