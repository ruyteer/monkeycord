// Compila a mesma interface do site e coloca em desktop/renderer.
// A diferença é que no app as chamadas de API vão pro site publicado
// (VITE_API_BASE) e os caminhos são relativos, porque roda em file://.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..", "..");
const destino = path.join(__dirname, "..", "renderer");
const site = process.env.MONKEYCORD_SITE || "https://monkeycord.netlify.app";

console.log(`> compilando a interface apontando para ${site}`);
// Chama o Vite pelo Node (no Windows o Node não executa .cmd direto)
const vite = path.join(raiz, "node_modules", "vite", "bin", "vite.js");
if (!fs.existsSync(vite)) {
  console.error("Rode 'npm install' na raiz do projeto antes.");
  process.exit(1);
}
execFileSync(process.execPath, [vite, "build", "--base", "./"], {
  cwd: raiz,
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE: site },
});

fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.join(raiz, "dist"), destino, { recursive: true });
console.log(`> interface copiada para ${path.relative(process.cwd(), destino)}`);
