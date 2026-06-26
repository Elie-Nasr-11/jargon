import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import gsap from "gsap";
import { getRouter } from "./router";
import { prefersReducedMotion } from "./lib/motion";
import "./styles.css";

// Honor prefers-reduced-motion for GSAP-driven animation. GSAP runs in JS and is
// unaffected by the CSS reduced-motion block in styles.css, so collapse global
// tween time: onComplete callbacks still fire (component state stays correct),
// there is just no visible motion. Covers every GSAP animation app-wide
// (HeaderMenus, SettingsMenu, ThemeToggle, Composer, route entrances).
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
