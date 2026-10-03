import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const pkgPath = path.join(projectRoot, 'package.json');

if (!fs.existsSync(pkgPath)) {
    console.error(`package.json not found at: ${pkgPath}`);
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Heavy dependencies that are ONLY used by upstream routes we discarded
// and NOT needed by RSSHub core or custom user routes.
const UNUSED_DEPS = [
    '@googleapis/youtube',
    'youtubei.js',
    'youtube-caption-extractor',
    'twitter-api-v2',
    'imapflow',
    'postal-mime',
    '@notionhq/client',
    'notion-to-md',
    'teleproto',
    'google-play-scraper',
    'fanfou-sdk',
    'mixi2',
    'narou',
    '@jocmp/mercury-parser',
    'sm-crypto-v2',
    '@honeybadger-io/js',
    '@scalar/hono-api-reference',
    '@rss3/sdk',
    'city-timezones',
    'jsdom',
    '@types/jsdom',
    'discord-api-types',
];

console.log(`[prune-deps] Original dependencies: ${Object.keys(pkg.dependencies || {}).length}`);

let removedCount = 0;
for (const dep of UNUSED_DEPS) {
    if (pkg.dependencies && pkg.dependencies[dep]) {
        delete pkg.dependencies[dep];
        removedCount++;
    }
    if (pkg.devDependencies && pkg.devDependencies[dep]) {
        delete pkg.devDependencies[dep];
    }
}

// Clean up pnpm patches and build restrictions
if (pkg.pnpm?.patchedDependencies) {
    for (const key of Object.keys(pkg.pnpm.patchedDependencies)) {
        if (UNUSED_DEPS.some((d) => key.startsWith(d))) {
            delete pkg.pnpm.patchedDependencies[key];
        }
    }
}

const NATIVE_BUILD_EXCLUDE = ['bufferutil', 'utf-8-validate', 'sharp', 'sleep'];
if (pkg.pnpm?.onlyBuiltDependencies) {
    pkg.pnpm.onlyBuiltDependencies = pkg.pnpm.onlyBuiltDependencies.filter(
        (dep) => !UNUSED_DEPS.includes(dep) && !NATIVE_BUILD_EXCLUDE.includes(dep)
    );
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');

console.log(`[prune-deps] Successfully removed ${removedCount} unused heavy dependencies.`);
console.log(`[prune-deps] Remaining dependencies: ${Object.keys(pkg.dependencies || {}).length}`);
