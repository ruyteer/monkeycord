import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Emojis por categoria, com palavras pra busca. Formato: "emoji palavras|emoji palavras". */
const RAW: [string, string][] = [
  [
    "Carinhas",
    "😀 sorriso feliz|😃 feliz|😄 rindo|😁 sorrisão|😆 risada|😅 suor nervoso|🤣 chorando de rir kkk|😂 chorando de rir kkk|🙂 leve|🙃 de ponta cabeça|😉 piscada|😊 corado|😇 anjo|🥰 apaixonado|😍 olhos de coração|🤩 estrela|😘 beijo|😋 delicia|😛 lingua|😜 piscada lingua|🤪 doido|😝 lingua|🤑 dinheiro|🤗 abraço|🤭 ops|🤫 silencio|🤔 pensando|🤐 boca fechada|🤨 desconfiado|😐 neutro|😑 sem expressão|😶 sem boca|😏 malicioso|😒 entediado|🙄 revirando olhos|😬 careta|😮‍💨 alivio|🤥 mentira|😌 aliviado|😔 triste pensativo|😪 sono|🤤 babando|😴 dormindo|😷 mascara doente|🤒 febre|🤕 machucado|🤢 enjoado|🤮 vomito|🥵 calor|🥶 frio|🥴 tonto|😵 tonto|🤯 explodindo cabeça|🤠 cowboy|🥳 festa|🥸 disfarce|😎 oculos escuros|🤓 nerd|🧐 monoculo|😕 confuso|😟 preocupado|🙁 triste|😮 surpreso|😯 surpreso|😲 chocado|😳 envergonhado|🥺 pidao|🥹 emocionado|😦 assustado|😨 medo|😰 ansioso|😥 triste aliviado|😢 chorando|😭 chorando muito|😱 grito|😖 confuso|😣 perseverante|😞 desapontado|😓 suor|😩 cansado|😫 exausto|🥱 bocejo|😤 bufando|😡 bravo|😠 raiva|🤬 palavrao|😈 diabinho|👿 diabo|💀 caveira morri|☠️ caveira|💩 coco|🤡 palhaço|👻 fantasma|👽 alien|🤖 robo|🐒 macaco monkey|🙈 macaco não vejo|🙉 macaco não ouço|🙊 macaco não falo",
  ],
  [
    "Gestos",
    "👍 joinha positivo sim|👎 negativo não|👌 ok|🤌 italiano|✌️ paz|🤞 dedos cruzados|🤟 te amo|🤘 rock|🤙 me liga|👈 esquerda|👉 direita|👆 cima|👇 baixo|☝️ um|✋ mão|🖐️ mão|🖖 vulcano|👋 tchau oi|👏 palmas|🙌 comemorar|🫶 coração mãos|👐 mãos abertas|🤲 mãos|🤝 aperto de mão|🙏 por favor obrigado reza|✍️ escrevendo|💪 forte braço|🦾 braço robo|🫡 continencia|🫠 derretendo|👀 olhos olhando|🧠 cerebro|🗣️ falando",
  ],
  [
    "Corações",
    "❤️ coração amor|🧡 laranja|💛 amarelo|💚 verde|💙 azul|💜 roxo|🖤 preto|🤍 branco|🤎 marrom|💔 coração partido|❣️ exclamação|💕 corações|💞 girando|💓 batendo|💗 crescendo|💖 brilhando|💘 flecha|💝 presente|🔥 fogo brabo|✨ brilho|⭐ estrela|🌟 estrela brilhando|💯 cem|💢 raiva|💥 explosão|💫 tonto|💦 gotas|💤 sono zzz",
  ],
  [
    "Coisas",
    "🎉 festa parabens|🎊 confete|🎂 bolo aniversario|🎁 presente|🏆 trofeu|🥇 ouro|🎮 videogame jogo|🕹️ joystick|🎲 dado|🎯 alvo|🎬 filme cinema|🍿 pipoca filme|📺 tv|🎧 fone musica|🎵 musica|🎶 musica|🎤 microfone karaoke|📱 celular|💻 notebook|🖥️ computador|⌨️ teclado|🖱️ mouse|📷 camera foto|📹 video|💡 ideia|📌 fixar|📎 clipe|🔒 cadeado|🔑 chave|💰 dinheiro|💸 gastando|⏰ alarme|⌛ ampulheta|🚀 foguete|✈️ aviao|🚗 carro|⚽ futebol bola|🏀 basquete|🍕 pizza|🍔 hamburguer|🍟 batata|🌭 cachorro quente|🍺 cerveja|🍻 brinde|☕ cafe|🧃 suco|🍫 chocolate|🍦 sorvete|🍌 banana macaco",
  ],
  [
    "Símbolos",
    "✅ certo feito|☑️ marcado|✔️ ok|❌ errado não|❎ x|⚠️ aviso|🚫 proibido|⛔ pare|❓ pergunta|❗ exclamação|‼️ urgente|⁉️ que|💬 conversa|🗯️ bravo|💭 pensando|🔔 sino|🔕 silencio|➕ mais|➖ menos|➡️ seta|⬅️ seta|⬆️ cima|⬇️ baixo|🔄 recarregar|🆗 ok|🆕 novo|🆒 legal|🔴 vermelho|🟢 verde|🟡 amarelo|🔵 azul|🟣 roxo|⚫ preto|⚪ branco",
  ],
];

const CATEGORIES = RAW.map(([name, list]) => ({
  name,
  emojis: list.split("|").map((e) => {
    const i = e.indexOf(" ");
    return { emoji: e.slice(0, i), words: e.slice(i + 1) };
  }),
}));

export const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥"];

const RECENT_KEY = "mc:emojis";

function recents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function remember(emoji: string) {
  try {
    const list = [emoji, ...recents().filter((e) => e !== emoji)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sem storage */
  }
}

/** Grade de emojis com busca e "usados recentemente". Vai dentro de um Popover. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<{ emoji: string; words: string } | null>(null);
  const recent = useMemo(recents, []);

  const query = q
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const sections = query
    ? [
        {
          name: "Resultados",
          emojis: CATEGORIES.flatMap((c) => c.emojis).filter((e) =>
            e.words.normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(query)
          ),
        },
      ]
    : [
        ...(recent.length ? [{ name: "Usados recentemente", emojis: recent.map((emoji) => ({ emoji, words: "" })) }] : []),
        ...CATEGORIES,
      ];

  const pick = (emoji: string) => {
    remember(emoji);
    onPick(emoji);
  };

  return (
    <div className="flex h-[360px] w-[332px] max-w-[calc(100vw-24px)] flex-col">
      <div className="p-2.5 pb-1.5">
        <label className="flex h-8 items-center gap-2 rounded-md bg-rail px-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Encontre o emoji perfeito"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Search className="size-4 text-muted-foreground" />
        </label>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {sections.map((s) => (
          <section key={s.name}>
            <h4 className="sticky top-0 z-10 bg-popover py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {s.name}
            </h4>
            <div className="grid grid-cols-8 gap-0.5">
              {s.emojis.map((e) => (
                <button
                  key={s.name + e.emoji}
                  type="button"
                  onClick={() => pick(e.emoji)}
                  onMouseEnter={() => setHover(e)}
                  className="flex aspect-square items-center justify-center rounded-md text-2xl hover:bg-white/10"
                >
                  {e.emoji}
                </button>
              ))}
            </div>
            {!s.emojis.length && <p className="py-6 text-center text-sm text-muted-foreground">Nada com esse nome</p>}
          </section>
        ))}
      </div>
      <div className={cn("flex h-11 shrink-0 items-center gap-2 border-t border-white/6 bg-black/20 px-3", !hover && "opacity-0")}>
        <span className="text-2xl">{hover?.emoji}</span>
        <span className="truncate text-sm font-semibold">{hover?.words.split(" ")[0]}</span>
      </div>
    </div>
  );
}
