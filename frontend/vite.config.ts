import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // R82: never base64-inline a font into the stylesheet. Vite inlines any asset
    // under 4 kB, which swept eleven small @font-face subsets (Cyrillic, Greek,
    // latin-ext) into index.css as base64 — 67 kB of render-blocking bytes that
    // gzip badly and that almost no reader ever paints a glyph from. Left as
    // separate files, the browser fetches a subset only when a character in its
    // unicode-range actually appears.
    assetsInlineLimit: (filePath: string) =>
      /\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
  },
});
