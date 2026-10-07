import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url);
let html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('style.css', root), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
for (const match of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]) {
  const js = await readFile(new URL(match[1], root), 'utf8');
  html = html.replace(match[0], `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
}
html = html.replace('<head>', '<head>\n  <base target="_top">');
await writeFile(new URL('apps-script/Index.html', root), html);
console.log('Apps Script Index.html built from current website files.');
