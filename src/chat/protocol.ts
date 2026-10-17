/**
 * Protocolo do gateway de chat/presença, no estilo do gateway do Discord.
 * Usado pelo app (src/chat) e pelo Worker (worker/src).
 *
 * Fluxo: conecta → HELLO (intervalo do heartbeat) → IDENTIFY (ou RESUME com a
 * sessão e o último `s` recebido) → READY/RESUMED → eventos (DISPATCH).
 * Mensagens, canais e arquivos mudam pela API REST (/api/...); o gateway só
 * avisa (MESSAGE_CREATE, MESSAGE_UPDATE, CHANNEL_CREATE...).
 */
export const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
  /** Sinalização da voz (WebRTC) entre duas sessões do mesmo canal. Não tem `s`, não fica guardado. */
  Signal: 12,
  /** "Fulano está digitando..." (também sem `s`) */
  Typing: 13,
} as const;

/** Heartbeat e resposta são strings fixas: o Durable Object responde sem acordar. */
export const HEARTBEAT = '{"op":1}';
export const HEARTBEAT_ACK = '{"op":11}';

/** Status que você escolhe. Invisível aparece como offline pros outros. */
export type Status = "online" | "idle" | "dnd" | "invisible";
/** Status que os outros veem */
export type VisibleStatus = "online" | "idle" | "dnd" | "offline";

export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Imagens: tamanho original, pra reservar o espaço antes de carregar */
  width?: number;
  height?: number;
};

export type Reaction = { emoji: string; users: string[] };

export type Message = {
  id: string;
  channelId: string;
  author: string;
  content: string;
  ts: number;
  editedTs?: number;
  pinned?: boolean;
  reactions?: Reaction[];
  attachments?: Attachment[];
  /** Resposta: retrato da mensagem respondida na hora do envio */
  replyTo?: { id: string; author: string; content: string };
  /** Id provisório que o app gerou ao mandar (pra trocar a mensagem otimista pela real) */
  nonce?: string;
};

export type ChannelKind = "text" | "voice";

export type Channel = {
  id: string;
  name: string;
  kind: ChannelKind;
  topic?: string;
  /** Canais de voz: nome da sala no RealtimeKit */
  room?: string;
  position: number;
};

export type VoiceState = {
  sessionId: string;
  name: string;
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
};

export type PresenceInfo = { name: string; status: VisibleStatus };

export type DispatchMap = {
  READY: { sessionId: string; presences: PresenceInfo[]; voice: VoiceState[]; channels: Channel[] };
  RESUMED: null;
  MESSAGE_CREATE: Message;
  /** Mensagem inteira de novo (editada, fixada, reação...) */
  MESSAGE_UPDATE: Message;
  MESSAGE_DELETE: { id: string; channelId: string };
  CHANNEL_CREATE: Channel;
  CHANNEL_DELETE: { id: string };
  PRESENCE_UPDATE: PresenceInfo;
  /** channelId null = saiu da voz */
  VOICE_STATE_UPDATE: Omit<VoiceState, "channelId"> & { channelId: string | null };
  /** Evento que não é pra você (conversa direta dos outros): só avança o `s` */
  NOOP: null;
};

export type Dispatch = {
  [K in keyof DispatchMap]: { op: typeof Op.Dispatch; t: K; s: number; d: DispatchMap[K] };
}[keyof DispatchMap];

export type ServerPayload =
  | Dispatch
  | { op: typeof Op.Hello; d: { heartbeatInterval: number } }
  | { op: typeof Op.HeartbeatAck }
  | { op: typeof Op.InvalidSession; d: boolean }
  | { op: typeof Op.Reconnect }
  | { op: typeof Op.Signal; d: { from: string; data: unknown } }
  | { op: typeof Op.Typing; d: { channelId: string; name: string } };

export type VoiceUpdate = { channelId: string | null; selfMute: boolean; selfDeaf: boolean };

export type ClientPayload =
  | { op: typeof Op.Heartbeat }
  | { op: typeof Op.Identify; d: { name: string; status?: Status } }
  | { op: typeof Op.PresenceUpdate; d: { status: Status } }
  | { op: typeof Op.Resume; d: { sessionId: string; seq: number } }
  | { op: typeof Op.VoiceStateUpdate; d: VoiceUpdate }
  | { op: typeof Op.Signal; d: { to: string; data: unknown } }
  | { op: typeof Op.Typing; d: { channelId: string } };

/** Códigos de fechamento do servidor (4000–4999) */
export const Close = {
  DecodeError: 4002,
  NotAuthenticated: 4003,
  InvalidName: 4004,
  AlreadyAuthenticated: 4005,
  SessionTimeout: 4009,
} as const;

/** Arquivos ficam no SQLite do canal: até 2 MB cada (imagens são reduzidas antes de subir). */
export const MAX_FILE = 2 * 1024 * 1024;

/**
 * Conversa direta: id fixo pros mesmos dois nomes, venha de quem vier.
 * Dois hashes de 32 bits pra caber em [\w-] sem colidir na prática.
 */
export function dmChannelId(a: string, b: string) {
  const key = [a, b].sort((x, y) => x.localeCompare(y)).join("\u0000");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) + 0x9e3779b9;
  }
  return `dm-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export const isDm = (channelId: string) => channelId.startsWith("dm-");
