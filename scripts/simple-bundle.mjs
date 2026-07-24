import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src/index.js');
const output = path.join(root, 'dist/cloudflare-worker-unico.js');
const modules = new Map();
const order = [];

function moduleId(file) {
  return `__module_${path.relative(root, file).replace(/[^a-zA-Z0-9_$]/g, '_')}`;
}

function parseImportClause(clause, dependencyId) {
  const lines = [];
  const trimmed = clause.trim();
  if (trimmed.startsWith('{')) {
    const inside = trimmed.slice(1, -1).trim();
    if (inside) lines.push(`const { ${inside} } = ${dependencyId};`);
    return lines;
  }
  if (trimmed.startsWith('* as ')) {
    lines.push(`const ${trimmed.slice(5).trim()} = ${dependencyId};`);
    return lines;
  }
  const comma = trimmed.indexOf(',');
  if (comma === -1) {
    lines.push(`const ${trimmed} = ${dependencyId}.default;`);
    return lines;
  }
  const defaultName = trimmed.slice(0, comma).trim();
  const rest = trimmed.slice(comma + 1).trim();
  if (defaultName) lines.push(`const ${defaultName} = ${dependencyId}.default;`);
  if (rest.startsWith('{')) {
    const inside = rest.slice(1, -1).trim();
    if (inside) lines.push(`const { ${inside} } = ${dependencyId};`);
  } else if (rest.startsWith('* as ')) {
    lines.push(`const ${rest.slice(5).trim()} = ${dependencyId};`);
  }
  return lines;
}

function declaredExportNames(source) {
  const names = new Set();
  const declarationRe = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationRe)) names.add(match[1]);
  const listRe = /\bexport\s*\{([\s\S]*?)\}\s*;/g;
  for (const match of source.matchAll(listRe)) {
    for (const part of match[1].split(',')) {
      const token = part.trim();
      if (!token) continue;
      const alias = token.split(/\s+as\s+/i);
      names.add((alias[1] || alias[0]).trim());
    }
  }
  return names;
}

async function visit(file) {
  file = path.resolve(file);
  if (modules.has(file)) return;
  let source = await fs.readFile(file, 'utf8');
  const imports = [];
  const importRe = /^\s*import\s+([\s\S]*?)\s+from\s+["'](.+?)["']\s*;?/gm;
  for (const match of source.matchAll(importRe)) {
    const dep = path.resolve(path.dirname(file), match[2]);
    imports.push({ full: match[0], clause: match[1], dep });
  }
  for (const item of imports) await visit(item.dep);

  const exports = declaredExportNames(source);
  const importLines = [];
  for (const item of imports) {
    source = source.replace(item.full, '');
    importLines.push(...parseImportClause(item.clause, moduleId(item.dep)));
  }

  let hasDefault = false;
  source = source.replace(/\bexport\s+default\s+/g, () => {
    hasDefault = true;
    return 'const __default__ = ';
  });
  source = source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/g, '');
  source = source.replace(/\bexport\s*\{[\s\S]*?\}\s*;/g, '');

  const returned = [...exports].map((name) => `${JSON.stringify(name)}: ${name}`);
  if (hasDefault) returned.push('default: __default__');
  const wrapped = `const ${moduleId(file)} = (() => {\n${importLines.join('\n')}\n${source}\nreturn { ${returned.join(', ')} };\n})();\n`;
  modules.set(file, { wrapped, exports: [...exports], hasDefault });
  order.push(file);
}

await visit(entry);
const banner = `// Ronda Editorial 2.1.1 — bundle autossuficiente para Cloudflare Workers\n// Gerado em ${new Date().toISOString()}\n`;
let bundle = banner + order.map((file) => modules.get(file).wrapped).join('\n');
const rootModule = modules.get(entry);
for (const name of rootModule.exports) bundle += `\nexport const ${name} = ${moduleId(entry)}[${JSON.stringify(name)}];`;
if (rootModule.hasDefault) bundle += `\nexport default ${moduleId(entry)}.default;\n`;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bundle);
console.log(`Bundle gerado: ${path.relative(root, output)} (${Buffer.byteLength(bundle)} bytes)`);
