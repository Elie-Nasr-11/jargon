// R56 "build from material" — turning whatever a teacher has into reference text.
//
// Everything here runs IN THE BROWSER, on the teacher's own file, before any text
// reaches the server. That keeps the ingestion story the same as the PDF path the
// platform already had: extract locally, let the teacher see it, send only text.
//
// Office formats are ZIP containers of XML. Rather than pull in a zip dependency,
// this uses the platform's own DecompressionStream("deflate-raw") — available in
// every browser we support — to inflate the one or two entries we actually want.

const TEXT_CAP = 40_000;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// --- minimal ZIP reader (central directory walk, stored + deflate entries) ------

type ZipEntry = { name: string; offset: number; compressed: number; size: number; method: number };

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD record is at the end, after an optional comment (max 65535).
  const start = Math.max(0, view.byteLength - 22 - 65_535);
  for (let i = view.byteLength - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && pointer + 46 <= view.byteLength; i += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressed = view.getUint32(pointer + 20, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decodeUtf8(new Uint8Array(buffer, pointer + 46, nameLength));
    entries.push({ name, offset: localOffset, compressed, size, method });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) return "";
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const dataStart = entry.offset + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, dataStart, entry.compressed);
  if (entry.method === 0) return decodeUtf8(data);
  if (entry.method !== 8) return "";
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return decodeUtf8(new Uint8Array(await new Response(stream).arrayBuffer()));
}

// --- XML → readable text -------------------------------------------------------

// Paragraph/line breaks first (so sentences don't run together), then strip tags.
function xmlToText(xml: string, breakTags: string[]): string {
  let out = xml;
  for (const tag of breakTags) {
    out = out.replace(new RegExp(`</${tag}>`, "gi"), "\n");
  }
  out = out.replace(/<[^>]+>/g, "");
  return out
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, TEXT_CAP);
}

/** Word document (.docx) → plain text. */
export async function extractDocxText(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer);
  const doc = entries.find((entry) => entry.name === "word/document.xml");
  if (!doc) return "";
  return xmlToText(await readZipEntry(buffer, doc), ["w:p", "w:br"]);
}

/** PowerPoint (.pptx) → plain text, one block per slide, in slide order. */
export async function extractPptxText(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer);
  const slides = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml$/)?.[1] || 0);
      const nb = Number(b.name.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return na - nb;
    });
  const blocks: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const text = xmlToText(await readZipEntry(buffer, slide), ["a:p", "a:br"]);
    if (text) blocks.push(`Slide ${index + 1}:\n${text}`);
    if (blocks.join("\n\n").length > TEXT_CAP) break;
  }
  return blocks.join("\n\n").slice(0, TEXT_CAP);
}

/** HTML (a saved page, or a fetched URL's body) → readable text. */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  return xmlToText(withoutNoise, ["p", "div", "li", "h1", "h2", "h3", "h4", "br", "tr"]);
}

/** Plain-text-ish file types the browser can read directly. */
export function isPlainTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || /\.(txt|md|markdown|csv|tsv|json|rtf|html?)$/.test(name);
}

export function isDocx(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function isPptx(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".pptx") ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

// ---------------------------------------------------------------------------
// R57: slicing a book-length upload per lesson.
//
// A whole-course build generates one lesson at a time. Feeding the ENTIRE upload
// into every lesson's generation is both wasteful and wrong: the model drifts
// toward the loudest part of the book instead of the passage that lesson teaches.
// So each generated lesson gets a WINDOW of the material — located by the
// source_hint the outline pass copied verbatim out of the text, with the lesson
// title as the fallback signal.
//
// Deliberately dumb (no embeddings, no server round-trip): the outline pass
// already did the semantic work, so this only has to find that phrase again and
// widen around it.

/** Words worth scoring — drops stop-words and punctuation-only tokens. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "as",
  "at",
  "by",
  "from",
  "that",
  "this",
  "it",
  "its",
  "how",
  "what",
  "why",
  "when",
  "into",
  "your",
  "you",
  "we",
  "our",
  "their",
  "they",
  "can",
  "will",
  "do",
  "does",
]);

function signalWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * The window of `material` that best matches a lesson.
 *
 * Splits into paragraphs, scores each against the hint + title signal words
 * (exact hint match dominates), then returns the best paragraph plus its
 * neighbours up to `maxChars` — contiguous, so the model reads prose, not
 * shuffled fragments. Falls back to the head of the material when nothing
 * matches (an outline drafted from a brief, or a hint the model paraphrased).
 */
export function sliceMaterialForLesson(
  material: string,
  lesson: { title: string; source_hint?: string },
  // R59: a book lesson is 20-35 pages (~25-40k chars). 6k was sized for a handout
  // and cut a real lesson off at its first section.
  maxChars = 24000,
): string {
  const text = material.trim();
  if (text.length <= maxChars) return text;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) return text.slice(0, maxChars);

  const hint = (lesson.source_hint || "").trim().toLowerCase();
  const words = signalWords(`${lesson.source_hint || ""} ${lesson.title}`);
  const scores = paragraphs.map((paragraph) => {
    const haystack = paragraph.toLowerCase();
    // A verbatim hint hit is worth more than any amount of word overlap.
    let score = hint && hint.length > 8 && haystack.includes(hint) ? 100 : 0;
    for (const word of words) if (haystack.includes(word)) score += 1;
    return score;
  });

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIndex = i;
    }
  }
  // Nothing matched: the head of the material is the honest default.
  if (bestScore <= 0) return text.slice(0, maxChars);

  // Grow outward from the best paragraph, preferring the higher-scoring side, so
  // the window keeps the passage in context.
  let start = bestIndex;
  let end = bestIndex;
  let size = paragraphs[bestIndex].length;
  while (size < maxChars && (start > 0 || end < paragraphs.length - 1)) {
    const beforeScore = start > 0 ? scores[start - 1] : -1;
    const afterScore = end < paragraphs.length - 1 ? scores[end + 1] : -1;
    if (afterScore >= beforeScore && end < paragraphs.length - 1) {
      end += 1;
      size += paragraphs[end].length + 2;
    } else if (start > 0) {
      start -= 1;
      size += paragraphs[start].length + 2;
    } else {
      break;
    }
  }
  return paragraphs
    .slice(start, end + 1)
    .join("\n\n")
    .slice(0, maxChars);
}
