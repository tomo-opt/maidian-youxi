import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const htmlPath = path.join(root, 'dist', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw new Error('dist/index.html 缺少内联脚本');
new Function(script[1]);

await import(pathToFileURL(path.join(root, 'cloudflare-worker', 'worker.js')));

for (const marker of ['/api/analyze', '/api/generate-character', '/api/validate-character', '/api/generate-action', '/api/generate-experience', 'maidian-youxi-ai.iog2026.workers.dev', 'sandbox="allow-scripts allow-pointer-lock"']) {
  if (!html.includes(marker)) throw new Error(`页面缺少关键项：${marker}`);
}

const worker = fs.readFileSync(path.join(root, 'cloudflare-worker', 'worker.js'), 'utf8');
for (const marker of ['flux-2-klein-4b', 'input_image_${index}', '{{CHARACTER_IMAGE}}', '{{ACTION_IMAGE}}']) {
  if (!worker.includes(marker)) throw new Error(`Worker 缺少产品角色化关键项：${marker}`);
}

console.log('静态页面脚本、Cloudflare Worker 与沙箱配置检查通过。');
