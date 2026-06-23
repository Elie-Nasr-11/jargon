import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
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
