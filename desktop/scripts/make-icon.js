// Gera build/icon.png (512x512) sem depender de nenhuma biblioteca:
// fundo escuro arredondado + uma câmera de vídeo branca.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const N = 512;
const px = Buffer.alloc(N * N * 4);

const dentroArredondado = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    let [r, g, b, a] = [0, 0, 0, 0];

    // fundo: quadrado arredondado quase preto, com um leve brilho no topo
    if (dentroArredondado(x, y, 0, 0, N - 1, N - 1, 112)) {
      const brilho = Math.max(0, 1 - Math.hypot(x - N / 2, y) / (N * 0.9));
      const base = 10 + brilho * 26;
      [r, g, b, a] = [base, base, base + 2, 255];
    }

    // corpo da câmera
    if (dentroArredondado(x, y, 118, 176, 330, 336, 34)) [r, g, b] = [250, 250, 250];

    // lente: triângulo apontando pra direita
    const tx = x - 350;
    const ty = y - 256;
    if (x >= 350 && x <= 408 && Math.abs(ty) <= 20 + tx * 1.1) [r, g, b] = [250, 250, 250];

    // ponto de gravação
    if ((x - 168) ** 2 + (y - 224) ** 2 <= 16 ** 2) [r, g, b] = [246, 130, 31];

    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  }
}

// --- PNG cru (IHDR + IDAT + IEND) ---
const tabela = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = tabela[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const bloco = (tipo, dados) => {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bits por canal
ihdr[9] = 6; // RGBA
const linhas = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  linhas[y * (N * 4 + 1)] = 0; // filtro "none"
  px.copy(linhas, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloco("IHDR", ihdr),
  bloco("IDAT", zlib.deflateSync(linhas, { level: 9 })),
  bloco("IEND", Buffer.alloc(0)),
]);

const saida = path.join(__dirname, "..", "build", "icon.png");
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, png);
console.log(`> ícone gerado: ${saida} (${(png.length / 1024).toFixed(0)} KB)`);
