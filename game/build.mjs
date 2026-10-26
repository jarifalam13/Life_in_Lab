// Builds the RoboSub game into one self-contained HTML file:
//   dist/duburi-robosub.html   open it directly in a browser
//   docs/game/index.html       the same page, served by GitHub Pages
// Images (DUBURI logo, handbook prints) are inlined as data URLs.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const t0 = Date.now();
const res = await build({
  entryPoints: [join(here, 'src/main.js')],
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2020'], write: false, legalComments: 'none',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl' },
  nodePaths: [join(repo, 'node_modules')],
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(here, 'src/ui/style.css'), 'utf8');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const fonts = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Saira+Semi+Condensed:wght@400;500;600;700&display=swap';
const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1f6fb2"/><text x="16" y="23" font-family="Arial,sans-serif" font-weight="700" font-size="19" text-anchor="middle" fill="#fff">D</text></svg>');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>DUBURI RoboSub</title>
<meta name="description" content="RoboSub 2025 'Protect the Deep' as a 1-4 player game on the DUBURI ROV simulator physics: pool, Pacific, Arctic and Atlantic water.">
<meta name="generator" content="DUBURI Simulator ${version}">
<link rel="icon" href="${favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>${css}</style>
</head>
<body>
<div id="app"><div class="boot">DUBURI RoboSub · loading…</div></div>
<noscript><p style="padding:24px;color:#e3eef3">This game needs JavaScript and WebGL.</p></noscript>
<script>${js}</script>
</body>
</html>
`;
for (const out of [join(repo, 'dist/duburi-robosub.html'), join(repo, 'docs/game/index.html')]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}
console.log(`game built in ${Date.now() - t0} ms, ${(html.length / 1024).toFixed(0)} KB`);
