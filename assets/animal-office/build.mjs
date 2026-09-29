// 開発時だけ使う: src/ と three.js を runtime.js（IIFE・minify）1本にまとめる。
// 生成物 runtime.js はコミットする（利用者は npm を使わず、animal-office-build.js が HTML に埋め込む）。
//   cd assets/animal-office && npm install && npm run build
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const threeVersion = JSON.parse(readFileSync(new URL('./node_modules/three/package.json', import.meta.url))).version;
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  charset: 'utf8',
  banner: { js: `/* animal-office runtime (drillspark-harness, Apache-2.0). Bundles three.js ${threeVersion} — Copyright © 2010-2024 three.js authors, MIT License. */` },
  outfile: 'runtime.js',
});
console.log(`runtime.js を書いた（three ${threeVersion}）`);
