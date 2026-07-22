import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = {
  "/": { contentType: "text/html; charset=utf-8", body: await readFile(resolve(root, "public/index.html"), "utf8") },
  "/index.html": { contentType: "text/html; charset=utf-8", body: await readFile(resolve(root, "public/index.html"), "utf8") },
  "/styles.css": { contentType: "text/css; charset=utf-8", body: await readFile(resolve(root, "public/styles.css"), "utf8") },
  "/app.js": { contentType: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "public/app.js"), "utf8") },
};

const output = `// Arquivo gerado. Não edite manualmente.\nexport const UI_ASSETS = Object.freeze(${JSON.stringify(assets)});\n`;
await writeFile(resolve(root, "src/ui.generated.js"), output, "utf8");
console.log("Interface incorporada ao Worker.");
