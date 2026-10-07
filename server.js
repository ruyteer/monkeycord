// Servidor Node sem dependências (Railway / local). Rodar: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

// Carrega .env local se existir (em produção use as variáveis do painel)
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { join } = require("./lib/rtk");
const dist = path.join(__dirname, "dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

http
  .createServer(async (req, res) => {
    if (req.url === "/api/join") {
      const cors = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { name, room } = JSON.parse(body || "{}");
        const out = await join(name, room);
        res.writeHead(200, cors).end(JSON.stringify(out));
      } catch (e) {
        console.error(e);
        res.writeHead(400, cors).end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    // Arquivos do build (npm run build); qualquer outra rota cai no index.html
    let url = req.url.split("?")[0];
    try {
      url = decodeURIComponent(url);
    } catch {}
    let file = path.join(dist, path.normalize(url).replace(/^[/\\]+/, ""));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dist, "index.html");
    }
    if (!fs.existsSync(file)) {
      res.writeHead(500).end("Rode npm run build antes");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(process.env.PORT || 3000, () => console.log(`Rodando em http://localhost:${process.env.PORT || 3000}`));
