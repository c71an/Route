import fs from 'node:fs';
import path from 'node:path';
import { nodeFileTrace } from '@vercel/nft';
import fse from 'fs-extra';

const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const resultFolder = path.join(projectRoot, 'app-minimal');

const entryFiles = [path.join(projectRoot, 'dist/index.mjs')];

console.log(`[minify] Tracing reachable dependencies from: ${entryFiles.join(', ')}`);

const { fileList: fileSet } = await nodeFileTrace(entryFiles, {
    base: projectRoot,
});

const fileList = [...fileSet].filter((file) => file.startsWith('node_modules/'));
console.log(`[minify] Traced ${fileList.length} reachable files in node_modules.`);

await fse.ensureDir(resultFolder);

// 1. Locate and preserve browsers.json for patchright/patchright-core/playwright-core (including under .pnpm)
const extraFiles = new Set();

// Find any package directories related to patchright/playwright in traced files
for (const file of fileList) {
    for (const pkg of ['patchright-core', 'patchright', 'playwright-core', 'playwright']) {
        const marker = `/${pkg}/`;
        const idx = file.indexOf(marker);
        if (idx !== -1) {
            const pkgRoot = file.slice(0, idx + marker.length - 1);
            const browsersJson = `${pkgRoot}/browsers.json`;
            if (fs.existsSync(path.join(projectRoot, browsersJson))) {
                extraFiles.add(browsersJson);
            }
        }
    }
    // oxc-parser dynamic assets
    if (file.endsWith('/oxc-parser/src-js/raw-transfer/eager.js')) {
        const deserializeDir = file.replace(/raw-transfer\/eager\.js$/, 'generated/deserialize');
        if (fs.existsSync(path.join(projectRoot, deserializeDir))) {
            extraFiles.add(deserializeDir);
        }
    }
}

// Global fallback scan for browsers.json in node_modules
function findBrowsersJson(dir) {
    if (!fs.existsSync(dir)) return;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Avoid infinite loops in symlinks if any
                findBrowsersJson(fullPath);
            } else if (entry.isFile() && entry.name === 'browsers.json') {
                const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
                extraFiles.add(relPath);
            }
        }
    } catch (e) {
        // ignore errors
    }
}
findBrowsersJson(path.join(projectRoot, 'node_modules'));

for (const extra of extraFiles) {
    if (!fileList.includes(extra)) {
        fileList.push(extra);
    }
}

let copied = 0;
for (const file of fileList) {
    const src = path.join(projectRoot, file);
    const dest = path.join(resultFolder, file);
    if (fs.existsSync(src)) {
        await fse.copy(src, dest, { overwrite: true });
        copied++;
    }
}

console.log(`[minify] Successfully copied ${copied} essential files into app-minimal (including ${extraFiles.size} browser/parser assets).`);

// Clean up non-essential files from minimal node_modules
console.log('[minify] Pruning documentation, typings, test suites, and source maps...');

const cleanFilePatterns = [
    /\.d\.ts$/,
    /\.d\.mts$/,
    /\.d\.cts$/,
    /\.map$/,
    /\.md$/i,
    /\.markdown$/i,
    /^license(\.txt|\.md)?$/i,
    /^changelog(\.txt|\.md)?$/i,
    /^readme(\.txt|\.md)?$/i,
];

const ignoredDirNames = new Set(['test', 'tests', '__tests__', '.github', 'docs', 'example', 'examples']);

function cleanDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (ignoredDirNames.has(entry.name.toLowerCase())) {
                fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
                cleanDirectory(fullPath);
            }
        } else if (entry.isFile()) {
            if (cleanFilePatterns.some((p) => p.test(entry.name))) {
                fs.unlinkSync(fullPath);
            }
        }
    }
}

cleanDirectory(path.join(resultFolder, 'node_modules'));
console.log('[minify] Minimal node_modules optimization complete!');
