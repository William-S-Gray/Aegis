// Copies the in-browser plate reader (tesseract.js) into public/ocr, so it is
// served by Aegis itself: the CSP allows no third-party scripts, and plate
// photos should not depend on someone else's CDN. Runs before dev and build.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = new URL('../public/ocr/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const core = pkg('tesseract.js-core');

copyFileSync(join(pkg('tesseract.js'), 'dist/worker.min.js'), join(out, 'worker.min.js'));
// LSTM-only engines; the worker picks the variant the device's CPU supports.
for (const file of readdirSync(core).filter((f) => f.endsWith('-lstm.wasm.js'))) {
  copyFileSync(join(core, file), join(out, file));
}
// "best_int": the accurate model in its smaller integer form (~3 MB).
copyFileSync(join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), join(out, 'eng.traineddata.gz'));
console.log('ocr: copied to public/ocr');
