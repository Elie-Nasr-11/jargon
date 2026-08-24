// Is the answer key machine-readable? pdf.js exposes fill colour through the
// operator list; pair each text run with the colour in force when it was drawn.
import { getDocument, OPS } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
const [file, pg] = [process.argv[2], Number(process.argv[3])];
const doc = await getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true }).promise;
const page = await doc.getPage(pg);
const ops = await page.getOperatorList();
let fill = [0, 0, 0];
const runs = [];
for (let i = 0; i < ops.fnArray.length; i += 1) {
  const fn = ops.fnArray[i];
  const args = ops.argsArray[i];
  if (fn === OPS.setFillRGBColor) fill = args.slice(0, 3);
  else if (fn === OPS.showText || fn === OPS.showSpacedText) {
    const glyphs = Array.isArray(args[0]) ? args[0] : [];
    const text = glyphs.map((g) => (g && typeof g === "object" && g.unicode) ? g.unicode : "").join("");
    if (text.trim()) runs.push({ fill: fill.join(","), text: text.trim() });
  }
}
const byColor = {};
for (const r of runs) byColor[r.fill] = (byColor[r.fill] || 0) + 1;
console.log("colours:", Object.entries(byColor).map(([c, n]) => `[${c}]x${n}`).join("  "));
console.log("\nNON-DEFAULT COLOUR RUNS (the answer key):");
const main = Object.entries(byColor).sort((a, b) => b[1] - a[1])[0][0];
for (const r of runs) if (r.fill !== main && r.text.length > 3) console.log(`  [${r.fill}] ${r.text}`);
