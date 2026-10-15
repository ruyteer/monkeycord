/**
 * Estrutura do servidor. Por enquanto fixa no código; quando tiver backend,
 * isso passa a vir da API (servidores, categorias, canais, permissões).
 */
export type ChannelKind = "text" | "voice";

export type Channel = {
  id: string;
  name: string;
  kind: ChannelKind;
  topic?: string;
  /** Canais de voz: nome da sala no RealtimeKit (o mesmo do ?sala= antigo) */
  room?: string;
};

export type Category = { id: string; name: string; channels: Channel[] };

export type Server = { id: string; name: string; short: string; categories: Category[] };

export const server: Server = {
  id: "monkeycord",
  name: "MonkeyCord",
  short: "MC",
  categories: [
    {
      id: "texto",
      name: "Canais de texto",
      channels: [
        { id: "geral", name: "geral", kind: "text", topic: "Papo solto da galera" },
        { id: "memes", name: "memes", kind: "text", topic: "Só coisa boa" },
        { id: "links", name: "links", kind: "text", topic: "Filmes, séries e o que mais for passar" },
      ],
    },
    {
      id: "voz",
      name: "Canais de voz",
      channels: [
        { id: "voz-geral", name: "Geral", kind: "voice", room: "geral" },
        { id: "voz-cinema", name: "Cinema", kind: "voice", room: "cinema" },
        { id: "voz-jogos", name: "Jogos", kind: "voice", room: "jogos" },
      ],
    },
  ],
};

export const allChannels = server.categories.flatMap((c) => c.channels);

export function findChannel(id: string) {
  return allChannels.find((c) => c.id === id);
}

/** Link antigo (?sala=xyz): usa o canal de voz dessa sala ou cria um avulso. */
export function voiceChannelForRoom(room: string): Channel {
  const r = room.trim().toLowerCase();
  return (
    allChannels.find((c) => c.kind === "voice" && c.room === r) ?? {
      id: `voz-${r}`,
      name: r,
      kind: "voice",
      room: r,
    }
  );
}
