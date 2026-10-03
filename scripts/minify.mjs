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

let copied = 0;
for (const file of fileList) {
    const src = path.join(projectRoot, file);
    const dest = path.join(resultFolder, file);
    if (fs.existsSync(src)) {
        await fse.copy(src, dest, { overwrite: true });
        copied++;
    }
}

console.log(`[minify] Successfully copied ${copied} essential files into app-minimal.`);

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
