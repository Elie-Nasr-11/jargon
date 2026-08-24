// The book's real skeleton: lesson titles (size 27) and section headings (size 18).
import { getDocument } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
const file = process.argv[2];
const doc = await getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true }).promise;
let pending = "";
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const items = (await page.getTextContent()).items.filter((it) => it.str.trim());
  let lessonBits = [];
  for (const it of items) {
    const size = Math.round(Math.abs(it.transform[3]));
    const str = it.str.trim();
    if (size >= 24 && str.length > 1) lessonBits.push(str);
    else if (size === 18 && str.length > 2 && !/^\d+$/.test(str)) {
      console.log(`    p${String(i).padStart(3)}  ${str}`);
    }
  }
  if (lessonBits.length) console.log(`\np${String(i).padStart(3)} ══ ${lessonBits.join(" ")}`);
}
