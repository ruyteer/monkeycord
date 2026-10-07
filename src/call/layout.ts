/**
 * Escolhe colunas/linhas que deixam os quadros maiores dentro do espaço.
 * O formato do quadro se adapta: em pé no celular vira retrato, na tela larga
 * vira 16:9. O vídeo usa object-cover, então preenche sem faixa preta.
 */
export function bestGrid(n: number, W: number, H: number, gap = 8) {
  let best = { cols: 1, rows: 1, w: 0, h: 0 };
  if (!n || !W || !H) return best;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (W - gap * (cols - 1)) / cols;
    const cellH = (H - gap * (rows - 1)) / rows;
    // limita entre 3:4 (retrato) e 16:9 (paisagem)
    const aspect = Math.min(16 / 9, Math.max(3 / 4, cellW / cellH));
    const w = Math.min(cellW, cellH * aspect);
    const h = w / aspect;
    if (w * h > best.w * best.h) best = { cols, rows, w, h };
  }
  return best;
}
