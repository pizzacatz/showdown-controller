// Bundles src/main.js into a single Tampermonkey userscript at
// dist/showdown-gamepad.user.js (IIFE, unminified, header from package.json).
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const RAW = 'https://raw.githubusercontent.com/pizzacatz/showdown-controller/main/dist/showdown-gamepad.user.js';

const header = `// ==UserScript==
// @name         Showdown Gamepad
// @namespace    https://github.com/pizzacatz/showdown-controller
// @version      ${pkg.version}
// @description  Play Pokémon Showdown battles with an XInput controller: D-pad/stick cursor, A confirm, B back, X switch menu, Y tera/gimmick. Mouse and keyboard keep working.
// @author       pizzacatz
// @license      MIT
// @match        *://play.pokemonshowdown.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    ${RAW}
// @downloadURL  ${RAW}
// ==/UserScript==
`;

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'firefox100'],
  write: false,
  banner: { js: header + "\n'use strict';" },
  legalComments: 'none',
});
const out = 'dist/showdown-gamepad.user.js';
writeFileSync(out, result.outputFiles[0].text);
console.log(`built ${out} (${result.outputFiles[0].text.length} bytes)`);
