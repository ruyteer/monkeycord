const lista = document.getElementById("lista");
const abaTelas = document.getElementById("aba-telas");
const abaJanelas = document.getElementById("aba-janelas");
let fontes = [];
let mostrandoTelas = true;

function desenhar() {
  abaTelas.setAttribute("aria-selected", String(mostrandoTelas));
  abaJanelas.setAttribute("aria-selected", String(!mostrandoTelas));
  lista.replaceChildren();
  for (const f of fontes.filter((f) => f.tela === mostrandoTelas)) {
    const botao = document.createElement("button");
    botao.className = "item";
    botao.title = f.name;
    const img = document.createElement("img");
    img.src = f.thumb;
    img.alt = "";
    const nome = document.createElement("span");
    nome.textContent = f.name;
    botao.append(img, nome);
    botao.addEventListener("click", () => window.picker.choose(f.id));
    lista.append(botao);
  }
}

abaTelas.addEventListener("click", () => {
  mostrandoTelas = true;
  desenhar();
});
abaJanelas.addEventListener("click", () => {
  mostrandoTelas = false;
  desenhar();
});
document.getElementById("cancelar").addEventListener("click", () => window.picker.cancel());
document.addEventListener("keydown", (e) => e.key === "Escape" && window.picker.cancel());

window.picker.list().then((f) => {
  fontes = f;
  mostrandoTelas = f.some((x) => x.tela);
  desenhar();
});
