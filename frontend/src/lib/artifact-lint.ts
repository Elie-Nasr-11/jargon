// Artifacts v1 (P6): static lint for html_sim documents. DEFENSE-IN-DEPTH ONLY —
// the sandboxed iframe (sandbox="allow-scripts", opaque origin, no allow-same-origin)
// is THE security boundary. This lint exists so obviously-violating content (network
// calls, storage access, external loads) is refused with a clear reason instead of
// silently failing inside the sandbox, and so P7's generate→approve flow can reject
// drafts before a teacher ever previews them.

export type ArtifactLintResult = { ok: boolean; violations: string[] };

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "network: fetch()", re: /\bfetch\s*\(/i },
  { label: "network: XMLHttpRequest", re: /XMLHttpRequest/i },
  { label: "network: WebSocket", re: /\bWebSocket\b/i },
  { label: "network: EventSource", re: /\bEventSource\b/i },
  { label: "network: navigator.sendBeacon", re: /navigator\s*\.\s*sendBeacon/i },
  { label: "code loading: dynamic import()", re: /\bimport\s*\(/ },
  { label: "code loading: importScripts", re: /\bimportScripts\s*\(/i },
  { label: "code loading: remote module import", re: /\bfrom\s+["']https?:\/\//i },
  { label: "storage: document.cookie", re: /document\s*\.\s*cookie/i },
  { label: "storage: localStorage", re: /\blocalStorage\b/i },
  { label: "storage: sessionStorage", re: /\bsessionStorage\b/i },
  { label: "storage: indexedDB", re: /\bindexedDB\b/i },
  { label: "embedding: <iframe>", re: /<iframe/i },
  // External src/href (http(s) + protocol-relative). data: URIs stay allowed — that's
  // how a self-contained sim inlines its images/fonts.
  { label: "external src/href", re: /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i },
];

export function lintArtifactHtml(html: string): ArtifactLintResult {
  const violations = FORBIDDEN.filter(({ re }) => re.test(html)).map(({ label }) => label);
  return { ok: violations.length === 0, violations };
}
