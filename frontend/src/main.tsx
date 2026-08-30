import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import gsap from "gsap";
import { getRouter } from "./router";
import { prefersReducedMotion } from "./lib/motion";
// Design-system type, self-hosted (R82). These ship @font-face rules with
// font-display:swap and woff2 files served from our own origin, so text paints
// immediately in the fallback face and the real face swaps in when it arrives.
// Neither the first paint nor the layout waits on a third-party font host.
import "@fontsource-variable/manrope";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
// KaTeX's stylesheet must load before styles.css so the app's math rules (which bind it
// to the theme) win on equal specificity. Fonts are bundled by Vite as assets.
import "katex/dist/katex.min.css";
import "./styles.css";

// Honor prefers-reduced-motion for GSAP-driven animation. GSAP runs in JS and is
// unaffected by the CSS reduced-motion block in styles.css, so collapse global
// tween time: onComplete callbacks still fire (component state stays correct),
// there is just no visible motion. Covers every GSAP animation app-wide
// (SettingsMenu, ThemeToggle, Composer, route entrances).
if (prefersReducedMotion()) {
  gsap.globalTimeline.timeScale(100);
}

const router = getRouter();
const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
