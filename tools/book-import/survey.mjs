// Survey a book with the SAME extractor the platform uses (pdf.js).
import { getDocument } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";

const file = process.argv[2];
const data = new Uint8Array(await readFile(file));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log(`FILE: ${file}`);
console.log(`PAGES: ${doc.numPages}`);

let totalChars = 0;
let pagesWithImages = 0;
let totalImages = 0;
const pages = [];
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const text = content.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
  totalChars += text.length;
  const ops = await page.getOperatorList();
  // OPS.paintImageXObject = 85, paintJpegXObject = 82 in pdf.js
  const imgs = ops.fnArray.filter((fn) => fn === 85 || fn === 82).length;
  if (imgs) pagesWithImages += 1;
  totalImages += imgs;
  pages.push({ n: i, chars: text.length, imgs, head: text.slice(0, 110) });
}
console.log(`TEXT: ${totalChars} chars (${Math.round(totalChars / doc.numPages)}/page avg)`);
console.log(`IMAGES: ${totalImages} across ${pagesWithImages} pages`);
console.log("\nFIRST 25 PAGES:");
for (const p of pages.slice(0, 25)) {
  console.log(`  p${String(p.n).padStart(3)} ${String(p.chars).padStart(5)}c ${String(p.imgs).padStart(2)}img  ${p.head}`);
}
