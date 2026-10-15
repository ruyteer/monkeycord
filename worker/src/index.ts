/**
 * Backend do chat e da presença do MonkeyCord (Cloudflare Workers + Durable Objects).
 *
 * - Gateway (um só, o do servidor): WebSocket estilo Discord. Sabe quem está
 *   online e em qual canal de voz, e espalha os eventos pra todo mundo.
 * - ChannelRoom (um por canal de texto): guarda o histórico em SQLite.
 *
 * Rotas:
 *   GET  /gateway                      WebSocket (ver src/chat/protocol.ts)
 *   GET  /api/channels/:id/messages    histórico (?limit=, ?before=ts)
 *   POST /api/channels/:id/messages    { author, content, nonce }
 */
import { DurableObject } from "cloudflare:workers";
import {
  Close,
  HEARTBEAT,
  HEARTBEAT_ACK,
  Op,
  type ClientPayload,
  type DispatchMap,
  type Message,
  type ServerPayload,
  type VoiceState,
} from "../../src/chat/protocol";
import { allChannels } from "../../src/shell/data";

export interface Env {
  GATEWAY: DurableObjectNamespace<Gateway>;
  CHANNELS: DurableObjectNamespace<ChannelRoom>;
}

const HEARTBEAT_MS = 30_000;
/** Sem heartbeat por esse tempo: a conexão morreu e ninguém avisou */
const ZOMBIE_MS = HEARTBEAT_MS * 2.5;
/** Quanto tempo uma sessão que caiu ainda aceita RESUME (e continua aparecendo online) */
const GRACE_MS = 20_000;
const SWEEP_MS = 15_000;
/** Eventos guardados pra repor num RESUME */
const KEEP_EVENTS = 1000;
const MAX_NAME = 40;
const MAX_CONTENT = 2000;

const textChannels = new Set(allChannels.filter((c) => c.kind === "text").map((c) => c.id));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const gateway = (env: Env) => env.GATEWAY.get(env.GATEWAY.idFromName("monkeycord"));

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/gateway") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Esperava um WebSocket" }, 426);
      return gateway(env).fetch(req);
    }

    const m = url.pathname.match(/^\/api\/channels\/([\w-]+)\/messages$/);
    if (m) {
      const channelId = m[1];
      if (!textChannels.has(channelId)) return json({ error: "Canal não existe" }, 404);
      const room = env.CHANNELS.get(env.CHANNELS.idFromName(channelId));

      if (req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
        const before = Number(url.searchParams.get("before")) || undefined;
        return json(await room.list(channelId, limit, before));
      }

      if (req.method === "POST") {
        let body: { author?: unknown; content?: unknown; nonce?: unknown };
        try {
          body = await req.json();
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const author = String(body.author ?? "").trim().slice(0, MAX_NAME);
        const content = String(body.content ?? "").trim();
        if (!author || !content) return json({ error: "Faltou autor ou texto" }, 400);
        if (content.length > MAX_CONTENT) return json({ error: "Mensagem grande demais" }, 413);
        const nonce = typeof body.nonce === "string" ? body.nonce.slice(0, 64) : undefined;
        const msg = await room.post(channelId, author, content, nonce);
        await gateway(env).messageCreated(msg);
        return json(msg, 201);
      }
      return json({ error: "Método não suportado" }, 405);
    }

    if (url.pathname === "/") return new Response("MonkeyCord chat no ar", { headers: cors });
    return json({ error: "Não encontrado" }, 404);
  },
} satisfies ExportedHandler<Env>;

/** Histórico de um canal de texto. */
export class ChannelRoom extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, author TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER NOT NULL, nonce TEXT
      )`
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS messages_ts ON messages (ts)");
  }

  list(channelId: string, limit: number, before?: number): Message[] {
    type Row = { id: string; author: string; content: string; ts: number };
    const rows = before
      ? this.sql.exec<Row>("SELECT id, author, content, ts FROM messages WHERE ts < ? ORDER BY ts DESC LIMIT ?", before, limit)
      : this.sql.exec<Row>("SELECT id, author, content, ts FROM messages ORDER BY ts DESC LIMIT ?", limit);
    return rows
      .toArray()
      .reverse()
      .map((r) => ({ id: r.id, channelId, author: r.author, content: r.content, ts: r.ts }));
  }

  post(channelId: string, author: string, content: string, nonce?: string): Message {
    // ts único e crescente: serve de ordem e de cursor pro ?before=
    const last = this.sql.exec<{ ts: number | null }>("SELECT MAX(ts) AS ts FROM messages").one().ts ?? 0;
    const ts = Math.max(Date.now(), last + 1);
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO messages (id, author, content, ts, nonce) VALUES (?, ?, ?, ?, ?)",
      id,
      author,
      content,
      ts,
      nonce ?? null
    );
    return { id, channelId, author, content, ts, nonce };
  }
}

/** Dados guardados em cada WebSocket (sobrevivem à hibernação do objeto). */
type Attachment = { at: number; sid?: string };

type SessionRow = {
  id: string;
  name: string;
  voice: string | null;
  mute: number;
  deaf: number;
  online: number;
  seen: number;
};

/**
 * Gateway: conexões, sessões e presença. Usa a API de hibernação, então o
 * objeto dorme entre eventos; o estado fica em SQLite e nos attachments.
 */
export class Gateway extends DurableObject<Env> {
  private sql: SqlStorage;
  private seq: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, voice TEXT,
        mute INTEGER NOT NULL DEFAULT 0, deaf INTEGER NOT NULL DEFAULT 0,
        online INTEGER NOT NULL DEFAULT 1, seen INTEGER NOT NULL
      )`
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, t TEXT NOT NULL, d TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    this.seq = this.sql.exec<{ v: number }>("SELECT v FROM meta WHERE k = 'seq'").toArray()[0]?.v ?? 0;
    // Heartbeat respondido pelo runtime, sem acordar o objeto
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT_ACK));
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ at: Date.now() } satisfies Attachment);
    send(server, { op: Op.Hello, d: { heartbeatInterval: HEARTBEAT_MS } });
    await this.armAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Chamado pelo Worker depois que o ChannelRoom salvou a mensagem. */
  messageCreated(msg: Message) {
    this.dispatch("MESSAGE_CREATE", msg);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let p: ClientPayload;
    try {
      if (typeof raw !== "string") throw new Error();
      p = JSON.parse(raw);
    } catch {
      ws.close(Close.DecodeError, "Payload inválido");
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;

    switch (p.op) {
      case Op.Heartbeat:
        // Heartbeat num formato diferente do fixo (o fixo nem chega aqui)
        ws.send(HEARTBEAT_ACK);
        return;

      case Op.Identify: {
        if (att.sid) return ws.close(Close.AlreadyAuthenticated, "Já identificado");
        const name = String(p.d?.name ?? "").trim().slice(0, MAX_NAME);
        if (!name) return ws.close(Close.InvalidName, "Nome inválido");
        this.sweepOrphans();
        const wasOnline = this.isOnline(name);
        const sid = crypto.randomUUID();
        this.sql.exec("INSERT INTO sessions (id, name, seen) VALUES (?, ?, ?)", sid, name, Date.now());
        ws.serializeAttachment({ ...att, sid } satisfies Attachment);
        send(ws, {
          op: Op.Dispatch,
          t: "READY",
          s: this.seq,
          d: { sessionId: sid, online: this.onlineNames(), voice: this.voiceStates() },
        });
        if (!wasOnline) this.dispatch("PRESENCE_UPDATE", { name, status: "online" });
        return;
      }

      case Op.Resume: {
        if (att.sid) return ws.close(Close.AlreadyAuthenticated, "Já identificado");
        const sid = String(p.d?.sessionId ?? "");
        const seq = Number(p.d?.seq);
        const row = this.session(sid);
        const oldest = this.sql.exec<{ s: number | null }>("SELECT MIN(seq) AS s FROM events").one().s;
        const missed = seq < this.seq && (oldest == null || oldest > seq + 1);
        if (!row || !Number.isInteger(seq) || seq > this.seq || missed) {
          send(ws, { op: Op.InvalidSession, d: false });
          return;
        }
        // Conexão antiga da mesma sessão (zumbi): sai sem derrubar a sessão
        for (const other of this.ctx.getWebSockets()) {
          if (other === ws || attachment(other).sid !== sid) continue;
          other.serializeAttachment({ at: Date.now() } satisfies Attachment);
          other.close(Close.SessionTimeout, "Sessão retomada em outra conexão");
        }
        this.sql.exec("UPDATE sessions SET online = 1, seen = ? WHERE id = ?", Date.now(), sid);
        ws.serializeAttachment({ ...att, sid } satisfies Attachment);
        const missedEvents = this.sql.exec<{ seq: number; t: string; d: string }>(
          "SELECT seq, t, d FROM events WHERE seq > ? ORDER BY seq",
          seq
        );
        for (const e of missedEvents) ws.send(`{"op":0,"t":${JSON.stringify(e.t)},"s":${e.seq},"d":${e.d}}`);
        send(ws, { op: Op.Dispatch, t: "RESUMED", s: this.seq, d: null });
        return;
      }

      case Op.VoiceStateUpdate: {
        if (!att.sid) return ws.close(Close.NotAuthenticated, "Mande IDENTIFY primeiro");
        const row = this.session(att.sid);
        if (!row) return ws.close(Close.SessionTimeout, "Sessão expirou");
        const raw = p.d?.channelId;
        const channelId = typeof raw === "string" && /^[\w-]{1,64}$/.test(raw) ? raw : null;
        const mute = p.d?.selfMute ? 1 : 0;
        const deaf = p.d?.selfDeaf ? 1 : 0;
        if (row.voice === channelId && row.mute === mute && row.deaf === deaf) return;
        this.sql.exec("UPDATE sessions SET voice = ?, mute = ?, deaf = ? WHERE id = ?", channelId, mute, deaf, row.id);
        this.dispatch("VOICE_STATE_UPDATE", {
          sessionId: row.id,
          name: row.name,
          channelId,
          selfMute: !!mute,
          selfDeaf: !!deaf,
        });
        return;
      }

      default:
        ws.close(Close.DecodeError, "Opcode desconhecido");
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // Fechou com 1000 (saiu do app/trocou de nome): sai na hora. Outro código: espera o RESUME.
    await this.drop(ws, code === 1000);
    try {
      ws.close(1000);
    } catch {
      /* já fechado */
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.drop(ws, false);
  }

  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachment(ws);
      const last = Math.max(att.at, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0);
      if (now - last < ZOMBIE_MS) continue;
      await this.drop(ws, false);
      ws.serializeAttachment({ at: att.at } satisfies Attachment);
      try {
        ws.close(Close.SessionTimeout, "Sem heartbeat");
      } catch {
        /* já fechado */
      }
    }
    this.sweepOrphans();
    const expired = this.sql.exec<{ id: string }>("SELECT id FROM sessions WHERE online = 0 AND seen < ?", now - GRACE_MS);
    for (const { id } of expired.toArray()) this.endSession(id);

    const sessions = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sessions").one().n;
    if (sessions || this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }

  private async drop(ws: WebSocket, clean: boolean) {
    const { sid } = attachment(ws);
    if (!sid) return;
    if (clean) this.endSession(sid);
    else {
      this.sql.exec("UPDATE sessions SET online = 0, seen = ? WHERE id = ?", Date.now(), sid);
      await this.armAlarm();
    }
  }

  /** Sessões marcadas online sem conexão (o objeto reiniciou num deploy, por exemplo) entram no período de graça. */
  private sweepOrphans() {
    const live = new Set(this.ctx.getWebSockets().map((ws) => attachment(ws).sid));
    const online = this.sql.exec<{ id: string }>("SELECT id FROM sessions WHERE online = 1").toArray();
    for (const { id } of online) {
      if (!live.has(id)) this.sql.exec("UPDATE sessions SET online = 0, seen = ? WHERE id = ?", Date.now(), id);
    }
  }

  private endSession(sid: string) {
    const row = this.session(sid);
    if (!row) return;
    this.sql.exec("DELETE FROM sessions WHERE id = ?", sid);
    if (row.voice) {
      this.dispatch("VOICE_STATE_UPDATE", {
        sessionId: sid,
        name: row.name,
        channelId: null,
        selfMute: false,
        selfDeaf: false,
      });
    }
    if (!this.isOnline(row.name)) this.dispatch("PRESENCE_UPDATE", { name: row.name, status: "offline" });
  }

  private dispatch<K extends keyof DispatchMap>(t: K, d: DispatchMap[K]) {
    const s = ++this.seq;
    const data = JSON.stringify(d);
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('seq', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", s);
    this.sql.exec("INSERT INTO events (seq, t, d) VALUES (?, ?, ?)", s, t, data);
    this.sql.exec("DELETE FROM events WHERE seq <= ?", s - KEEP_EVENTS);
    const frame = `{"op":0,"t":${JSON.stringify(t)},"s":${s},"d":${data}}`;
    for (const ws of this.ctx.getWebSockets()) {
      if (!attachment(ws).sid) continue;
      try {
        ws.send(frame);
      } catch {
        /* conexão caindo; o RESUME repõe */
      }
    }
  }

  private session(id: string) {
    return this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id = ?", id).toArray()[0] ?? null;
  }

  /** Sessão no período de graça ainda conta como online (evita piscar offline num F5). */
  private isOnline(name: string) {
    return this.sql.exec("SELECT 1 FROM sessions WHERE name = ? LIMIT 1", name).toArray().length > 0;
  }

  private onlineNames() {
    return this.sql.exec<{ name: string }>("SELECT DISTINCT name FROM sessions ORDER BY name").toArray().map((r) => r.name);
  }

  private voiceStates(): VoiceState[] {
    return this.sql
      .exec<SessionRow>("SELECT * FROM sessions WHERE voice IS NOT NULL")
      .toArray()
      .map((r) => ({ sessionId: r.id, name: r.name, channelId: r.voice!, selfMute: !!r.mute, selfDeaf: !!r.deaf }));
  }

  private async armAlarm() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}

function attachment(ws: WebSocket) {
  return (ws.deserializeAttachment() ?? { at: 0 }) as Attachment;
}

function send(ws: WebSocket, p: ServerPayload) {
  ws.send(JSON.stringify(p));
}
