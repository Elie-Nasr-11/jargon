#!/usr/bin/env node
// R66 — LIVE smoke test: run a real student turn against the DEPLOYED chat function.
//
// The repo's 1000+ pins and the deno property suite verify code structure and the
// pure state machine — they are blind, by construction, to the seams where every
// recent production failure actually lived: RLS policies, live auth, session
// state, client/server drift, and the model API. This script closes that gap: it
// signs in as a dedicated smoke-test student and drives the same HTTP calls the
// real client makes, against the same deployed function students use.
//
// What one run proves end-to-end:
//   1. Password sign-in works (auth).
//   2. A turn sent with a STALE session pointer self-heals (R65) instead of
//      looping the student-safe error — and returns a usable session.
//   3. A resume turn on the returned session completes with a non-empty mentor
//      reply (context load, RLS reads/writes, model call, envelope, persistence).
//
// Requirements (GitHub secrets / env):
//   SMOKE_EMAIL, SMOKE_PASSWORD — a dedicated STUDENT account enrolled in a class
//     that carries SMOKE_LESSON_ID (default itf-a1-ch1-l1). Never a real student.
// Optional:
//   SMOKE_LESSON_ID, SUPABASE_URL, SUPABASE_ANON_KEY (both default to the
//   project's public values; the anon key is parsed from the frontend source,
//   where it is public by design).
//
// Missing credentials → exit 0 with a loud SKIPPED warning, so CI stays green
// until the secrets are added — but a configured run that fails exits 1 and turns
// the workflow red.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DEFAULT_URL = "https://qztpieiizmiayzjhezwh.supabase.co";
// A well-formed uuid that can never exist — exercises the R65 stale-pointer heal
// without tripping PostgREST's uuid parser (a malformed id would 400 as transport).
const BOGUS_SESSION_ID = "00000000-0000-4000-8000-000000000000";

function anonKeyFromFrontend() {
  try {
    const src = readFileSync(new URL("../frontend/src/lib/supabase.ts", import.meta.url), "utf8");
    const m = src.match(/"(eyJ[^"]+)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

const url = process.env.SUPABASE_URL || DEFAULT_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || anonKeyFromFrontend();
const email = process.env.SMOKE_EMAIL || "";
const password = process.env.SMOKE_PASSWORD || "";
const lessonId = process.env.SMOKE_LESSON_ID || "itf-a1-ch1-l1";

if (!email || !password) {
  console.log("::warning title=Live smoke SKIPPED::SMOKE_EMAIL / SMOKE_PASSWORD secrets are not set — the deployed chat function is NOT being verified. Add a dedicated smoke-student account's credentials as repository secrets.");
  process.exit(0);
}
if (!anonKey) {
  console.error("Could not resolve the anon key (env SUPABASE_ANON_KEY or frontend source).");
  process.exit(1);
}

function fail(step, detail) {
  console.error(`SMOKE FAILED at ${step}: ${detail}`);
  process.exit(1);
}

async function signIn() {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    fail("sign-in", `HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token;
}

async function turn(token, body, label) {
  const startedAt = Date.now();
  const res = await fetch(`${url}/functions/v1/chat`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ stream: false, client_msg_id: randomUUID(), ...body }),
  });
  const ms = Date.now() - startedAt;
  const envelope = await res.json().catch(() => null);
  if (!res.ok) {
    fail(label, `HTTP ${res.status} in ${ms}ms — ${JSON.stringify(envelope)?.slice(0, 400) ?? "unparseable body"}`);
  }
  if (!envelope || envelope.status === "error") {
    fail(label, `envelope status=error in ${ms}ms — ${JSON.stringify(envelope)?.slice(0, 400)}`);
  }
  const reply = typeof envelope.reply === "string" ? envelope.reply.trim() : "";
  if (!reply) fail(label, `empty mentor reply in ${ms}ms`);
  if (typeof envelope.session_id !== "string" || !envelope.session_id) {
    fail(label, "envelope carries no session_id");
  }
  console.log(`${label}: ok in ${ms}ms (session ${envelope.session_id}, reply ${reply.length} chars)`);
  return envelope;
}

const token = await signIn();
console.log("sign-in: ok");

// Turn 1 — deliberately stale pointer: must self-heal, never bubble.
const healed = await turn(
  token,
  {
    lesson_id: lessonId,
    session_id: BOGUS_SESSION_ID,
    answer: { mode: "text", text: "hello! quick systems check — what are we looking at today?" },
  },
  "stale-pointer turn",
);
if (healed.session_id === BOGUS_SESSION_ID) {
  fail("stale-pointer turn", "server echoed the bogus session id instead of healing");
}

// Turn 2 — resume the healed session like a normal client.
await turn(
  token,
  {
    lesson_id: lessonId,
    session_id: healed.session_id,
    answer: { mode: "text", text: "thanks — just checking in, carry on." },
  },
  "resume turn",
);

console.log("LIVE SMOKE PASSED: the deployed student path is serving turns.");
