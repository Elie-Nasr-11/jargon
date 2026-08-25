// Which book pages deserve a page-image in the imported lessons?
//
// The books' diagrams are mostly vector line art with no captions or figure
// numbers, so nothing can be "extracted" — instead whole pages are rendered as
// images (render-pages.mjs) and bound to the steps that teach them. This script
// picks the pages: raster-image pages first, then pages whose own text points at a
// visual, capped per lesson so the media stage stays a garnish, not a slideshow.
import { getDocument, OPS } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, readdir, writeFile } from "node:fs/promises";

const [file, outDirArg, manifestPath] = [process.argv[2], process.argv[3], process.argv[4]];
const VISUAL_CUE =
  /\b(diagram|image below|image above|shown below|shown above|illustration|chart|graph|picture|figure below|as shown)\b/i;
const MAX_PER_LESSON = 8;

const doc = await getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: true,
}).promise;

// Raster census + per-page text, one pass.
const rasterPages = new Set();
const pageText = new Map();
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  if (ops.fnArray.some((fn) => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject)) {
    rasterPages.add(n);
  }
  pageText.set(n, content.items.map((it) => it.str).join(" "));
}

// Lessons come from the extractor's index.
const index = JSON.parse(await readFile(`${outDirArg}/index.json`, "utf8"));
const manifest = { book: index[0]?.slug?.slice(0, 2) ?? "", lessons: {} };
for (const row of index) {
  const [from, to] = row.pages;
  const lessonDoc = JSON.parse(await readFile(`${outDirArg}/${row.slug}.json`, "utf8"));
  const headingFor = (page) => {
    let best = "";
    for (const section of lessonDoc.sections) {
      if (section.page <= page) best = section.title;
    }
    return best || lessonDoc.lesson.title;
  };
  const picks = new Map(); // page -> why (ranked: raster > activity-cue > text-cue)
  for (let page = from + 1; page <= to; page += 1) {
    if (rasterPages.has(page)) picks.set(page, "raster");
  }
  for (const activity of lessonDoc.activities) {
    const activityText = `${activity.intro} ${activity.items.map((item) => item.stem).join(" ")}`;
    if (!VISUAL_CUE.test(activityText)) continue;
    for (let page = activity.page; page <= activity.pageEnd; page += 1) {
      if (page > from && !picks.has(page)) picks.set(page, "activity-cue");
    }
  }
  for (let page = from + 1; page <= to; page += 1) {
    if (!picks.has(page) && VISUAL_CUE.test(pageText.get(page) ?? "")) picks.set(page, "text-cue");
  }
  const rank = { raster: 0, "activity-cue": 1, "text-cue": 2 };
  const chosen = [...picks.entries()]
    .sort((a, b) => rank[a[1]] - rank[b[1]] || a[0] - b[0])
    .slice(0, MAX_PER_LESSON)
    .sort((a, b) => a[0] - b[0]);
  manifest.lessons[row.slug] = chosen.map(([page, why]) => ({
    page,
    why,
    heading: headingFor(page),
  }));
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
let total = 0;
for (const [slug, pages] of Object.entries(manifest.lessons)) {
  total += pages.length;
  console.log(`  ${slug.padEnd(12)} ${pages.length} pages  (${pages.map((p) => p.page).join(", ")})`);
}
console.log(`${manifest.book}: ${total} pages selected`);
