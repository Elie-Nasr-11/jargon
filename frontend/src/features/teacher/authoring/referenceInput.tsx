/**
 * Choosing the material a generation runs against.
 *
 * Every build point in the studio - outline, steps, artifacts - starts from the
 * same question: which of this class's resources should the model read? This is
 * that picker, plus the two helpers that turn a chosen resource into the text a
 * prompt can carry.
 */
import { useEffect, useMemo, useState } from "react";
import { TextArea } from "@/features/teacher/authoring/fields";
import { getSession, readImageMaterial, readUrlMaterial } from "@/lib/api";
import {
  extractDocxText,
  extractPptxText,
  htmlToText,
  isDocx,
  isPlainTextFile,
  isPptx,
} from "@/lib/materialText";
import { extractPdfTextChunksFromUrl } from "@/lib/pdf-extract";
import type { LessonResource } from "@/lib/types";
import { ChevronRight, Paperclip, X } from "lucide-react";

export function resourceReferenceText(resource: LessonResource): string {
  return [resource.description, resource.student_instructions, resource.transcript_text]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n")
    .trim();
}

export function combineReference(
  paste: string,
  docs: Array<{ name: string; text: string }>,
  pickedResources: Array<{ title: string; text: string }>,
): string {
  const sections: string[] = [];
  if (paste.trim()) sections.push(`[Pasted notes]\n${paste.trim()}`);
  for (const doc of docs)
    if (doc.text.trim()) sections.push(`[Document: ${doc.name}]\n${doc.text.trim()}`);
  for (const res of pickedResources) {
    if (res.text.trim()) sections.push(`[Resource: ${res.title}]\n${res.text.trim()}`);
  }
  return sections.join("\n\n");
}

export function AiReferenceInput({
  resources,
  busy,
  onChange,
}: {
  resources: LessonResource[];
  busy: boolean;
  onChange: (referenceText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [docs, setDocs] = useState<Array<{ name: string; text: string }>>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [fileError, setFileError] = useState("");

  const usableResources = useMemo(
    () => resources.filter((resource) => resourceReferenceText(resource).length > 0),
    [resources],
  );

  useEffect(() => {
    const picked = usableResources
      .filter((resource) => resourceIds.includes(resource.id))
      .map((resource) => ({ title: resource.title, text: resourceReferenceText(resource) }));
    onChange(combineReference(paste, docs, picked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paste, docs, resourceIds, usableResources]);

  // R56: teachers bring what they have — PDFs, Word, PowerPoint, notes, and photos of
  // worksheets. Office formats and PDFs are read IN THE BROWSER; only images need the
  // server (vision), and only the resulting text is ever sent on.
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setExtracting(true);
    const added: Array<{ name: string; text: string }> = [];
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        let text = "";
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const url = URL.createObjectURL(file);
          try {
            const chunks = await extractPdfTextChunksFromUrl(url);
            text = chunks.map((chunk) => chunk.chunk_text).join(" ");
          } finally {
            URL.revokeObjectURL(url);
          }
        } else if (isDocx(file)) {
          text = await extractDocxText(file);
        } else if (isPptx(file)) {
          text = await extractPptxText(file);
        } else if (file.type.startsWith("image/")) {
          const session = await getSession();
          if (!session) throw new Error("Sign in again to read images.");
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read that image."));
            reader.readAsDataURL(file);
          });
          text = await readImageMaterial(session.access_token, dataUrl);
        } else if (isPlainTextFile(file)) {
          const raw = await file.text();
          text = /\.html?$/i.test(file.name) ? htmlToText(raw) : raw;
        } else {
          throw new Error("Unsupported file type.");
        }
        // R59: a real chapter upload is ~140k characters (111 pages). The old 40k cap
        // silently truncated it to the first lesson and a half, so the outline pass
        // proposed a course for a chapter it had only read the start of.
        if (text.trim()) added.push({ name: file.name, text: text.trim().slice(0, 400000) });
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    setDocs((current) => [...current, ...added]);
    setFileError(
      failed.length
        ? `Couldn't read ${failed.join(", ")} — try a PDF, Word, PowerPoint, image, or plain-text file.`
        : "",
    );
    setExtracting(false);
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    setLinkBusy(true);
    setFileError("");
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to read links.");
      const result = await readUrlMaterial(session.access_token, url);
      if (!result.text.trim()) throw new Error("That page had no readable text.");
      setDocs((current) => [
        ...current,
        { name: result.title || url, text: result.text.slice(0, 400000) },
      ]);
      setLink("");
    } catch (error) {
      setFileError((error as Error).message || "Could not read that link.");
    } finally {
      setLinkBusy(false);
    }
  };

  const summary =
    [
      paste.trim() ? "notes" : "",
      docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : "",
      resourceIds.length
        ? `${resourceIds.length} resource${resourceIds.length === 1 ? "" : "s"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "optional";

  return (
    <div className="rounded-card border border-border bg-depth-sub p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-meta font-medium text-foreground"
      >
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        Reference material
        <span className="text-meta font-normal text-muted-foreground">{summary}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <TextArea label="Paste source text" value={paste} onChange={setPaste} />
          <div className="grid gap-1">
            <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Upload files (PDF, Word, PowerPoint, images, notes)
            </span>
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.html,.htm,.pdf,.docx,.pptx,image/*,text/plain,application/pdf"
              disabled={busy || extracting}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
              className="jargon-input file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-meta file:text-foreground"
            />
            {extracting ? (
              <span className="text-meta text-muted-foreground">Reading files…</span>
            ) : null}
            {fileError ? <span className="text-meta text-danger">{fileError}</span> : null}
            {docs.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {docs.map((doc, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground"
                  >
                    <span className="max-w-[160px] truncate">{doc.name}</span>
                    <button
                      type="button"
                      onClick={() => setDocs((current) => current.filter((_, idx) => idx !== i))}
                      aria-label="Remove file"
                      className="hover:text-foreground"
                    >
                      <X className="h-3 w-3" strokeWidth={1.8} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-1">
            <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Add a link
            </span>
            <div className="flex gap-2">
              <input
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addLink();
                  }
                }}
                placeholder="https://…"
                disabled={busy || linkBusy}
                className="jargon-input min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => void addLink()}
                disabled={busy || linkBusy || !link.trim()}
                className="btn btn-secondary btn-sm shrink-0"
              >
                {linkBusy ? "Reading…" : "Read page"}
              </button>
            </div>
          </div>
          {usableResources.length ? (
            <div className="grid gap-1">
              <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Use existing resources
              </span>
              <div className="grid max-h-40 gap-1 overflow-auto">
                {usableResources.map((resource) => (
                  <label
                    key={resource.id}
                    className="flex items-center gap-2 text-meta text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={resourceIds.includes(resource.id)}
                      onChange={() =>
                        setResourceIds((current) =>
                          current.includes(resource.id)
                            ? current.filter((id) => id !== resource.id)
                            : [...current, resource.id],
                        )
                      }
                      className="h-3.5 w-3.5 accent-foreground"
                    />
                    <span className="min-w-0 truncate">{resource.title}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
