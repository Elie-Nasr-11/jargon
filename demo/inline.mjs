// Produce a single self-contained HTML (fonts inlined) that opens/plays anywhere with a double-click.
//   node inline.mjs  ->  jargon-portal-demo.standalone.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(DIR, 'jargon-portal-demo.html'), 'utf8');
const fonts = fs.readFileSync(path.join(DIR, 'fonts.embed.css'), 'utf8');
const out = html.replace(
  /<link rel="stylesheet" href="\.\/fonts\.embed\.css"\/>/,
  `<style>/* Inter + Instrument Serif (latin), base64 */\n${fonts}\n</style>`
);
const dest = path.join(DIR, 'jargon-portal-demo.standalone.html');
fs.writeFileSync(dest, out);
console.log('wrote', dest, `(${(out.length / 1024).toFixed(0)} KB)`);
