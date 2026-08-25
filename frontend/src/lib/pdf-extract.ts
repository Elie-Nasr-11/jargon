import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFPageProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedPdfChunk = {
  page_number: number;
  chunk_index: number;
  chunk_text: string;
};

export type RenderedPdfPageAsset = {
  page_number: number;
  asset_type: "thumbnail" | "ocr_image";
  blob: Blob;
  width: number;
  height: number;
  mime_type: "image/jpeg";
  metadata: Record<string, unknown>;
};

const MAX_CHUNK_CHARS = 1400;
const MAX_RENDER_PAGES = 30;
const THUMBNAIL_WIDTH = 360;
const OCR_IMAGE_WIDTH = 1400;

function textFromItem(item: unknown): string {
  if (item && typeof item === "object" && "str" in item && typeof item.str === "string") {
    return item.str;
  }
  return "";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// R59: WHAT THE COLOUR KNOWS.
//
// Publisher teacher editions mark the answer key by colour — the IT Frontiers
// Teacher Editions print every correct multiple-choice option and every written
// model answer in red. getTextContent() throws that away, so a teacher uploading a
// teacher edition used to hand us the questions and hide the answers, leaving the
// generator to GUESS a key the book was already telling us.
//
// Which colour is the key, though? Measured over a real 111-page chapter:
//
//   colour     pages   runs   avg len   what it is
//   #65666b      59%   1494        45   body ink
//   #43454b      68%   1438        22   body ink
//   #102694      96%    454        13   running header + headings
//   #ff5739      24%    260        42   THE ANSWER KEY
//   #69c675      96%    177        13   running header
//   #ff4227      12%    124         9   accent scraps
//
// Page furniture is on most pages in SHORT runs; body ink carries most of the
// words; a key is a sliver of text on a minority of pages in long runs. So the
// decision needs the whole document, not one page — hence a stats pass first. Run
// over all four chapter PDFs of the two books, these four tests pick the key (and
// the Notes-sidebar ink) and drop both body inks, both running heads and every
// decorative scrap. No hue is hardcoded, so any book that colours its key (or its
// vocabulary) benefits, and books that colour nothing lose nothing.
const MARK_MAX_TEXT_SHARE = 0.15; // carries the bulk of the words ⇒ body ink
const MARK_MAX_PAGE_SHARE = 0.5; // on over half the pages ⇒ structural, not a mark
const MARK_MIN_AVG_CHARS = 12; // short runs are labels and captions
const MARK_MIN_PAGES = 3; // one-off decoration is not a system

// …and one test that is about the TEXT rather than the colour. A running head says
// the same thing on page after page; an answer says something different every time.
// Chapter 2 of book A1 sets its running title in a colour it also uses for section
// names, so no colour rule can separate them — but "computers & beyond" repeating on
// 43 of 105 pages gives itself away. Stripping those runs cut that chapter's marks
// from 83 pages to 34 without touching the other three.
const REPEAT_PAGE_SHARE = 0.1;
const REPEAT_MIN_PAGES = 3;

type ColourRun = { fill: string; text: string };

function runsWithColour(ops: { fnArray: number[]; argsArray: unknown[] }): ColourRun[] {
  let fill = "";
  const runs: ColourRun[] = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] === OPS.setFillRGBColor) {
      const args = ops.argsArray[i] as unknown[] | undefined;
      const arg = args?.[0];
      fill = typeof arg === "string" ? arg.toLowerCase() : "";
    } else if (ops.fnArray[i] === OPS.showText) {
      const args = ops.argsArray[i] as unknown[] | undefined;
      const glyphs = args?.[0];
      if (!Array.isArray(glyphs)) continue;
      const text = glyphs
        .map((g) => (g && typeof g === "object" && "unicode" in g ? String(g.unicode ?? "") : ""))
        .join("")
        .trim();
      if (text) runs.push({ fill, text });
    }
  }
  return runs;
}

/** Runs whose exact text recurs across many pages — i.e. running heads. */
function withoutRunningFurniture(pages: ColourRun[][]): ColourRun[][] {
  const pagesForText = new Map<string, Set<number>>();
  pages.forEach((runs, index) => {
    for (const run of runs) {
      const key = run.text.toLowerCase();
      const seen = pagesForText.get(key) || new Set<number>();
      seen.add(index);
      pagesForText.set(key, seen);
    }
  });
  const limit = Math.max(REPEAT_MIN_PAGES, pages.length * REPEAT_PAGE_SHARE);
  return pages.map((runs) =>
    runs.filter((run) => (pagesForText.get(run.text.toLowerCase())?.size ?? 0) <= limit),
  );
}

/** Colours that behave like a mark rather than like page furniture. */
function markColoursFor(pages: ColourRun[][]): Set<string> {
  const stats = new Map<string, { pages: number; runs: number; chars: number }>();
  for (const runs of pages) {
    const seen = new Set<string>();
    for (const run of runs) {
      const stat = stats.get(run.fill) || { pages: 0, runs: 0, chars: 0 };
      if (!seen.has(run.fill)) {
        stat.pages += 1;
        seen.add(run.fill);
      }
      stat.runs += 1;
      stat.chars += run.text.length;
      stats.set(run.fill, stat);
    }
  }
  if (!stats.size) return new Set();
  // NOT "everything but the most-used colour": these books set body copy in TWO
  // inks, so single-dominant let one of them through and half the chapter came back
  // "marked". Share of the total TEXT is the honest test — body ink carries the
  // bulk of the words, a key carries a sliver of them.
  const totalChars = [...stats.values()].reduce((sum, stat) => sum + stat.chars, 0) || 1;
  const marks = new Set<string>();
  for (const [fill, stat] of stats) {
    if (stat.chars / totalChars > MARK_MAX_TEXT_SHARE) continue; // body ink
    if (stat.pages / pages.length > MARK_MAX_PAGE_SHARE) continue; // furniture
    if (stat.chars / stat.runs < MARK_MIN_AVG_CHARS) continue; // scraps
    if (stat.pages < MARK_MIN_PAGES) continue; // one-off decoration
    marks.add(fill);
  }
  return marks;
}

function splitPageText(text: string, pageNumber: number): ExtractedPdfChunk[] {
  const clean = normalizeText(text);
  if (!clean) return [];

  const chunks: ExtractedPdfChunk[] = [];
  let remaining = clean;
  let chunkIndex = 0;

  while (remaining.length > MAX_CHUNK_CHARS) {
    const window = remaining.slice(0, MAX_CHUNK_CHARS);
    const splitAt = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    );
    const end = splitAt > 500 ? splitAt + 1 : MAX_CHUNK_CHARS;
    const chunkText = normalizeText(remaining.slice(0, end));
    if (chunkText) {
      chunks.push({
        page_number: pageNumber,
        chunk_index: chunkIndex,
        chunk_text: chunkText,
      });
      chunkIndex += 1;
    }
    remaining = normalizeText(remaining.slice(end));
  }

  if (remaining) {
    chunks.push({
      page_number: pageNumber,
      chunk_index: chunkIndex,
      chunk_text: remaining,
    });
  }

  return chunks;
}

export async function extractPdfTextChunksFromUrl(url: string): Promise<ExtractedPdfChunk[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not open the PDF for extraction.");
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pdf = await getDocument({ data: bytes }).promise;
  const chunks: ExtractedPdfChunk[] = [];

  const pageTexts: string[] = [];
  const pageRuns: ColourRun[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map(textFromItem).filter(Boolean).join(" "));
    // Colour is a bonus on top of the text; a PDF that refuses an operator list
    // must still extract.
    try {
      pageRuns.push(runsWithColour(await page.getOperatorList()));
    } catch {
      pageRuns.push([]);
    }
  }

  // The colours are judged on the RAW runs — stripping furniture first would shrink
  // a running head's page count and let it back in — and the furniture-free runs are
  // what actually gets written onto the page.
  const markColours = markColoursFor(pageRuns);
  const contentRuns = withoutRunningFurniture(pageRuns);
  for (let i = 0; i < pageTexts.length; i += 1) {
    const marked = markColours.size
      ? contentRuns[i]
          .filter((run) => markColours.has(run.fill) && run.text.length > 3)
          .map((r) => r.text)
      : [];
    // The marks ride WITH their page, so a question and its key stay together no
    // matter how the material is later sliced per lesson.
    const withMarks = marked.length
      ? `${pageTexts[i]}\n[Marked in the source (in a teacher edition these are usually the answers): ${marked.join(" | ")}]`
      : pageTexts[i];
    chunks.push(...splitPageText(withMarks, i + 1));
  }

  return chunks;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Could not render PDF page image.");
  return blob;
}

async function renderPageImage(
  page: PDFPageProxy,
  pageNumber: number,
  assetType: "thumbnail" | "ocr_image",
  targetWidth: number,
): Promise<RenderedPdfPageAsset> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.25, targetWidth / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not render PDF page image.");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const blob = await canvasToJpeg(canvas, assetType === "thumbnail" ? 0.76 : 0.82);
  return {
    page_number: pageNumber,
    asset_type: assetType,
    blob,
    width: canvas.width,
    height: canvas.height,
    mime_type: "image/jpeg",
    metadata: {
      rendered_width: canvas.width,
      rendered_height: canvas.height,
      target_width: targetWidth,
      renderer: "pdfjs",
    },
  };
}

export async function renderPdfPageAssetsFromUrl(url: string): Promise<RenderedPdfPageAsset[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not open the PDF for page previews.");
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pdf = await getDocument({ data: bytes }).promise;
  const pageLimit = Math.min(pdf.numPages, MAX_RENDER_PAGES);
  const assets: RenderedPdfPageAsset[] = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    assets.push(await renderPageImage(page, pageNumber, "thumbnail", THUMBNAIL_WIDTH));
    assets.push(await renderPageImage(page, pageNumber, "ocr_image", OCR_IMAGE_WIDTH));
  }

  return assets;
}
