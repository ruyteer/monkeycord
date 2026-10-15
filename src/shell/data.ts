import type { Channel } from "../chat/protocol";

export type { Channel, ChannelKind } from "../chat/protocol";

export const server = { id: "monkeycord", name: "MonkeyCord", short: "MC" };

/**
 * Canais iniciais. O gateway cria esses na primeira vez; depois os canais vêm
 * dele (dá pra criar e apagar pelo menu do servidor). O app usa esta lista
 * enquanto não chega o READY.
 */
export const defaultChannels: Channel[] = [
  { id: "geral", name: "geral", kind: "text", topic: "Papo solto da galera", position: 0 },
  { id: "memes", name: "memes", kind: "text", topic: "Só coisa boa", position: 1 },
  { id: "links", name: "links", kind: "text", topic: "Filmes, séries e o que mais for passar", position: 2 },
  { id: "voz-geral", name: "Geral", kind: "voice", room: "geral", position: 0 },
  { id: "voz-cinema", name: "Cinema", kind: "voice", room: "cinema", position: 1 },
  { id: "voz-jogos", name: "Jogos", kind: "voice", room: "jogos", position: 2 },
];

export const categories = [
  { kind: "text", name: "Canais de texto" },
  { kind: "voice", name: "Canais de voz" },
] as const;

/** Link antigo (?sala=xyz): usa o canal de voz dessa sala ou cria um avulso. */
export function voiceChannelForRoom(room: string, channels: Channel[]): Channel {
  const r = room.trim().toLowerCase();
  return (
    channels.find((c) => c.kind === "voice" && (c.room ?? c.id) === r) ?? {
      id: `voz-${r.replace(/[^\w-]/g, "-")}`,
      name: r,
      kind: "voice",
      room: r,
      position: 999,
    }
  );
}

/** Nome de canal no formato do Discord: minúsculo, sem espaço. */
export function slugChannel(name: string, kind: "text" | "voice") {
  const n = name.trim().slice(0, 40);
  if (kind === "voice") return n;
  return n
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}
