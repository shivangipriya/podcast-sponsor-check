// Tiny static server for local use: npm start, then open http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
createServer(async (req, res) => {
  const p = normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { "content-type": types[extname(file)] || "text/plain" }).end(await readFile(file)); }
  catch { res.writeHead(404).end("Not found"); }
}).listen(Number(process.env.PORT) || 8080, () => console.log("http://localhost:" + (process.env.PORT || 8080)));
