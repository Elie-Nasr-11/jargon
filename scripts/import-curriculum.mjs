#!/usr/bin/env node
// R58: put a book into Jargon, one chapter document at a time.
//
//   node scripts/import-curriculum.mjs --file books/ict-f/ch3.json
//   node scripts/import-curriculum.mjs --dir  books/ict-f
//
// Signs in as a teacher or admin with the SAME credentials the app uses — there is
// deliberately no service-role path here, so an import can never do more than the
// person running it could do in the studio. Figures are uploaded first (private
// bucket), then the chapter document is posted with the object paths.
//
// Safe to re-run: the importer is idempotent by the ids in the document, and it
// refuses to touch rows another import (or a teacher) owns. See
// docs/CURRICULUM_IMPORT.md.
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, resolve, dirname } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const SUPABASE_URL = process.env.SUPABASE_URL || flag("url");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || flag("anon-key");
const EMAIL = process.env.JARGON_EMAIL || flag("email");
const PASSWORD = process.env.JARGON_PASSWORD || flag("password");
const DRY_RUN = args.includes("--dry-run");

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error(
    "Missing credentials. Set SUPABASE_URL, SUPABASE_ANON_KEY, JARGON_EMAIL, JARGON_PASSWORD\n" +
      "(or pass --url --anon-key --email --password).",
  );
  process.exit(2);
}

const rest = (path) => `${SUPABASE_URL.replace(/\/$/, "")}${path}`;

async function signIn() {
  const res = await fetch(rest("/auth/v1/token?grant_type=password"), {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Sign-in failed (${res.status}): ${body.error_description || body.msg || ""}`);
  }
  return body.access_token;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

// Figures travel as files next to the chapter document, referenced by `file`.
// They are uploaded to figures/<import_key>/<chapter>/<name> and the returned path
// goes into storage_path. Re-running skips images that are already there byte-wise
// (upsert is cheap, but a book is hundreds of images and re-uploads are the slow part).
async function uploadFigure(token, localPath, objectPath) {
  const bytes = await readFile(localPath);
  const ext = extname(localPath).toLowerCase();
  const res = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/lesson-resources/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": MIME[ext] || "application/octet-stream",
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figure upload failed for ${localPath} (${res.status}): ${text.slice(0, 200)}`);
  }
  return objectPath;
}

async function importChapter(token, docPath) {
  const raw = await readFile(docPath, "utf8");
  const doc = JSON.parse(raw);
  const importKey = doc.import_key;
  const chapter = basename(docPath, ".json");
  if (!importKey) throw new Error(`${docPath}: import_key is required.`);

  // Upload every figure that points at a local file, rewriting it to storage_path.
  let uploaded = 0;
  for (const lesson of doc.lessons || []) {
    for (const figure of lesson.figures || []) {
      if (!figure.file) continue;
      const localPath = resolve(dirname(docPath), figure.file);
      const safeName = basename(figure.file).replace(/[^A-Za-z0-9._-]/g, "-");
      const objectPath = `figures/${importKey}/${chapter}/${safeName}`;
      if (!DRY_RUN) await uploadFigure(token, localPath, objectPath);
      figure.storage_path = objectPath;
      delete figure.file;
      uploaded += 1;
    }
  }

  if (DRY_RUN) {
    const lessons = (doc.lessons || []).length;
    console.log(`  [dry run] ${chapter}: ${lessons} lessons, ${uploaded} figures — not sent.`);
    return { report: null };
  }

  const res = await fetch(rest("/functions/v1/curriculum-admin"), {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "import_curriculum", ...doc }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== "ok") {
    throw new Error(`${chapter}: import failed (${res.status}): ${body.error || JSON.stringify(body).slice(0, 300)}`);
  }
  return { report: body.report, uploaded };
}

const summarize = (report) =>
  [
    `units +${report.units.created}/~${report.units.updated}`,
    `lessons +${report.lessons.created}/~${report.lessons.updated}${report.lessons.skipped ? `/skip ${report.lessons.skipped}` : ""}`,
    `steps +${report.steps.created}/~${report.steps.updated}`,
    `figures +${report.figures.created}/~${report.figures.updated}${report.figures.skipped ? `/skip ${report.figures.skipped}` : ""}`,
  ].join(" · ");

async function main() {
  const file = flag("file");
  const dir = flag("dir");
  if (!file && !dir) {
    console.error("Pass --file <chapter.json> or --dir <book/>.");
    process.exit(2);
  }

  const token = await signIn();
  const docs = file
    ? [resolve(file)]
    : (await readdir(resolve(dir)))
        .filter((name) => name.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => join(resolve(dir), name));

  console.log(`Importing ${docs.length} chapter${docs.length === 1 ? "" : "s"} as ${EMAIL}${DRY_RUN ? " (dry run)" : ""}`);
  let failures = 0;
  for (const docPath of docs) {
    const label = basename(docPath);
    try {
      const { report, uploaded } = await importChapter(token, docPath);
      if (report) {
        console.log(`  ok  ${label} — ${summarize(report)}${uploaded ? ` (${uploaded} images)` : ""}`);
        for (const warning of report.warnings || []) console.log(`      ! ${warning}`);
      }
    } catch (error) {
      failures += 1;
      // One bad chapter must not abandon the rest of the book — report and continue.
      console.error(`  FAIL ${label} — ${error.message}`);
    }
  }
  console.log(failures ? `\n${failures} chapter(s) failed. Fix and re-run — the import is idempotent.` : "\nDone. Everything landed as drafts; publish from the studio.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
