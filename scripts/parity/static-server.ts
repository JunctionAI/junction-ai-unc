/* Tiny static file server for design-reference/ — lets the self-contained .dc.html
   prototypes load over http:// (their runtime pulls React + Babel from unpkg and the
   <image-slot> component fetches a sidecar, none of which work from file://).

   No dependencies: Node's http module only. Path traversal is refused. */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticServer {
  origin: string;
  port: number;
  close: () => Promise<void>;
}

export function startStaticServer(rootDir: string, port = 0): Promise<StaticServer> {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const rel = decodeURIComponent(url.pathname);
      const abs = path.resolve(root, "." + rel);
      if (!abs.startsWith(root + path.sep) && abs !== root) {
        res.writeHead(403).end("forbidden");
        return;
      }
      let file = abs;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) {
        // The image-slot component probes a sidecar JSON next to the page; an empty object keeps it quiet.
        if (file.endsWith(".image-slots.state.json")) {
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
          return;
        }
        res.writeHead(404).end("not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        origin: `http://127.0.0.1:${p}`,
        port: p,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
