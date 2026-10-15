/**
 * Protocolo do gateway de chat/presença, no estilo do gateway do Discord.
 * Usado pelo app (src/chat) e pelo Worker (worker/src).
 *
 * Fluxo: conecta → HELLO (intervalo do heartbeat) → IDENTIFY (ou RESUME com a
 * sessão e o último `s` recebido) → READY/RESUMED → eventos (DISPATCH).
 * Mensagens novas e o histórico vão pela API REST (/api/channels/:id/messages);
 * o gateway só avisa (MESSAGE_CREATE).
 */
export const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/** Heartbeat e resposta são strings fixas: o Durable Object responde sem acordar. */
export const HEARTBEAT = '{"op":1}';
export const HEARTBEAT_ACK = '{"op":11}';

export type Message = {
  id: string;
  channelId: string;
  author: string;
  content: string;
  ts: number;
  /** Id provisório que o app gerou ao mandar (pra trocar a mensagem otimista pela real) */
  nonce?: string;
};

export type VoiceState = {
  sessionId: string;
  name: string;
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
};

export type DispatchMap = {
  READY: { sessionId: string; online: string[]; voice: VoiceState[] };
  RESUMED: null;
  MESSAGE_CREATE: Message;
  PRESENCE_UPDATE: { name: string; status: "online" | "offline" };
  /** channelId null = saiu da voz */
  VOICE_STATE_UPDATE: Omit<VoiceState, "channelId"> & { channelId: string | null };
};

export type Dispatch = {
  [K in keyof DispatchMap]: { op: typeof Op.Dispatch; t: K; s: number; d: DispatchMap[K] };
}[keyof DispatchMap];

export type ServerPayload =
  | Dispatch
  | { op: typeof Op.Hello; d: { heartbeatInterval: number } }
  | { op: typeof Op.HeartbeatAck }
  | { op: typeof Op.InvalidSession; d: boolean }
  | { op: typeof Op.Reconnect };

export type VoiceUpdate = { channelId: string | null; selfMute: boolean; selfDeaf: boolean };

export type ClientPayload =
  | { op: typeof Op.Heartbeat }
  | { op: typeof Op.Identify; d: { name: string } }
  | { op: typeof Op.Resume; d: { sessionId: string; seq: number } }
  | { op: typeof Op.VoiceStateUpdate; d: VoiceUpdate };

/** Códigos de fechamento do servidor (4000–4999) */
export const Close = {
  DecodeError: 4002,
  NotAuthenticated: 4003,
  InvalidName: 4004,
  AlreadyAuthenticated: 4005,
  SessionTimeout: 4009,
} as const;
