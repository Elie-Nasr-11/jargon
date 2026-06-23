import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedPdfChunk = {
  page_number: number;
  chunk_index: number;
  chunk_text: string;
};

const MAX_CHUNK_CHARS = 1400;

function textFromItem(item: unknown): string {
  if (item && typeof item === "object" && "str" in item && typeof item.str === "string") {
    return item.str;
  }
  return "";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map(textFromItem).filter(Boolean).join(" ");
    chunks.push(...splitPageText(pageText, pageNumber));
  }

  return chunks;
}
