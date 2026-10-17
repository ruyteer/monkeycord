// Compila a mesma interface do site e coloca em desktop/renderer.
// A diferença é que os caminhos são relativos, porque roda em file://.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..", "..");
const destino = path.join(__dirname, "..", "renderer");
const chat = process.env.VITE_CHAT_URL || "https://monkeycord-chat.monkeycord.workers.dev";

console.log(`> compilando a interface (chat: ${chat})`);
// Chama o Vite pelo Node (no Windows o Node não executa .cmd direto)
const vite = path.join(raiz, "node_modules", "vite", "bin", "vite.js");
if (!fs.existsSync(vite)) {
  console.error("Rode 'npm install' na raiz do projeto antes.");
  process.exit(1);
}
execFileSync(process.execPath, [vite, "build", "--base", "./"], {
  cwd: raiz,
  stdio: "inherit",
  env: { ...process.env, VITE_CHAT_URL: chat },
});

fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.join(raiz, "dist"), destino, { recursive: true });
console.log(`> interface copiada para ${path.relative(process.cwd(), destino)}`);
