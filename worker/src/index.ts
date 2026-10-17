/**
 * Backend do chat e da presença do MonkeyCord (Cloudflare Workers + Durable Objects).
 *
 * - Gateway (um só, o do servidor): WebSocket estilo Discord. Sabe quem está
 *   online, com qual status e em qual canal de voz, guarda a lista de canais e
 *   espalha os eventos.
 * - ChannelRoom (um por canal de texto ou conversa direta): histórico,
 *   reações, fixadas e arquivos, em SQLite.
 *
 * Rotas:
 *   GET    /gateway                                   WebSocket (ver src/chat/protocol.ts)
 *   POST   /api/channels                              { name, kind, topic? } cria canal
 *   DELETE /api/channels/:id                          apaga canal (e o histórico)
 *   GET    /api/channels/:id/messages                 histórico (?limit=, ?before=ts)
 *   POST   /api/channels/:id/messages                 { author, content, nonce?, attachments?, members? }
 *   PATCH  /api/channels/:id/messages/:mid            { author, content } edita (só o autor)
 *   DELETE /api/channels/:id/messages/:mid            { author } apaga (só o autor)
 *   PUT    /api/channels/:id/messages/:mid/pin        fixa · DELETE desafixa
 *   PUT    /api/channels/:id/messages/:mid/reactions  { emoji, user } reage · DELETE tira
 *   GET    /api/channels/:id/pins                     mensagens fixadas
 *   GET    /api/channels/:id/search?q=                busca no texto
 *   POST   /api/channels/:id/files                    corpo = arquivo (X-Filename, X-Width, X-Height)
 *   GET    /api/channels/:id/files/:fid               baixa o arquivo
 *   GET    /api/ice                                   servidores STUN/TURN pra voz (P2P)
 *
 * Não tem login: "autor" é o nome que o app manda. Serve pra galera, não pra
 * um servidor aberto.
 */
import { DurableObject } from "cloudflare:workers";
import {
  Close,
  HEARTBEAT,
  HEARTBEAT_ACK,
  isDm,
  MAX_FILE,
  Op,
  type Attachment,
  type Channel,
  type ClientPayload,
  type DispatchMap,
  type Message,
  type PresenceInfo,
  type ServerPayload,
  type Status,
  type VisibleStatus,
  type VoiceState,
} from "../../src/chat/protocol";
import { defaultChannels } from "../../src/shell/data";

export interface Env {
  GATEWAY: DurableObjectNamespace<Gateway>;
  CHANNELS: DurableObjectNamespace<ChannelRoom>;
  /**
   * TURN opcional (wrangler secret put ...): repassa a mídia quando duas
   * pessoas não conseguem se ligar direto (alguns roteadores/operadoras).
   * Ex.: um servidor coturn seu, ou o plano grátis do metered.ca.
   * TURN_URLS separadas por vírgula.
   */
  TURN_URLS?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
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
const MAX_CHANNELS = 50;
const STATUSES: Status[] = ["online", "idle", "dnd", "invisible"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Filename, X-Width, X-Height",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const gateway = (env: Env) => env.GATEWAY.get(env.GATEWAY.idFromName("monkeycord"));
const room = (env: Env, channelId: string) => env.CHANNELS.get(env.CHANNELS.idFromName(channelId));

const cleanName = (v: unknown) => String(v ?? "").trim().slice(0, MAX_NAME);

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      return await route(req, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      // Erros lançados dentro do Durable Object chegam sem a classe
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/^HTTP (\d{3}): (.*)$/s);
      if (m) return json({ error: m[2] }, Number(m[1]));
      console.error(err);
      return json({ error: "Erro no servidor" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const gw = gateway(env);

  if (path === "/gateway") {
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Esperava um WebSocket" }, 426);
    return gw.fetch(req);
  }
  if (path === "/") return new Response("MonkeyCord chat no ar", { headers: cors });

  // Voz é P2P: o app só precisa saber por onde achar o caminho até os outros
  if (path === "/api/ice") {
    const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];
    if (env.TURN_URLS) {
      iceServers.push({
        urls: env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean),
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }
    return json({ iceServers });
  }

  // Canais
  if (path === "/api/channels") {
    if (req.method === "GET") return json(await gw.channels());
    if (req.method === "POST") {
      const b = await body<{ name: string; kind: string; topic: string }>(req);
      return json(await gw.createChannel(String(b.name ?? ""), b.kind === "voice" ? "voice" : "text", b.topic), 201);
    }
    throw new HttpError(405, "Método não suportado");
  }
  let m = path.match(/^\/api\/channels\/([\w-]{1,64})$/);
  if (m && req.method === "DELETE") {
    const ch = await gw.deleteChannel(m[1]);
    if (ch.kind === "text") await room(env, m[1]).wipe();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/channels\/([\w-]{1,64})\/(.+)$/);
  if (!m) throw new HttpError(404, "Não encontrado");
  const [, channelId, rest] = m;
  if (!isDm(channelId) && (await gw.channelKind(channelId)) !== "text") throw new HttpError(404, "Canal não existe");
  const r = room(env, channelId);
  // Conversa direta: só os dois recebem os eventos
  const to = isDm(channelId) ? await r.members() : undefined;

  if (rest === "messages") {
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
      const before = Number(url.searchParams.get("before")) || undefined;
      return json(await r.list(channelId, limit, before));
    }
    if (req.method === "POST") {
      const b = await body<{
        author: string;
        content: string;
        nonce: string;
        attachments: Attachment[];
        members: string[];
        replyTo: string;
      }>(req);
      const author = cleanName(b.author);
      const content = String(b.content ?? "").trim();
      const files = Array.isArray(b.attachments) ? b.attachments.map((a) => String(a?.id ?? "")).slice(0, 10) : [];
      if (!author || (!content && !files.length)) throw new HttpError(400, "Faltou autor ou texto");
      if (content.length > MAX_CONTENT) throw new HttpError(413, "Mensagem grande demais");
      const nonce = typeof b.nonce === "string" ? b.nonce.slice(0, 64) : undefined;
      let rcpt = to;
      if (isDm(channelId) && !rcpt?.length) {
        // Primeira mensagem da conversa: guarda quem participa
        const members = Array.isArray(b.members) ? [...new Set(b.members.map(cleanName).filter(Boolean))] : [];
        if (members.length !== 2 || !members.includes(author)) throw new HttpError(400, "Conversa direta sem participantes");
        rcpt = await r.setMembers(members);
      }
      if (rcpt && !rcpt.includes(author)) throw new HttpError(403, "Você não está nessa conversa");
      const replyTo = typeof b.replyTo === "string" ? b.replyTo.slice(0, 64) : undefined;
      const msg = await r.post(channelId, author, content, files, nonce, replyTo);
      await gw.publish("MESSAGE_CREATE", msg, rcpt);
      return json(msg, 201);
    }
    throw new HttpError(405, "Método não suportado");
  }

  if (rest === "pins" && req.method === "GET") return json(await r.pins(channelId));

  if (rest === "search" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    return json(q ? await r.search(channelId, q) : []);
  }

  if (rest === "files" && req.method === "POST") {
    const size = Number(req.headers.get("Content-Length"));
    if (size > MAX_FILE) throw new HttpError(413, "Arquivo maior que 2 MB");
    const data = await req.arrayBuffer();
    if (!data.byteLength) throw new HttpError(400, "Arquivo vazio");
    if (data.byteLength > MAX_FILE) throw new HttpError(413, "Arquivo maior que 2 MB");
    let name = "arquivo";
    try {
      name = decodeURIComponent(req.headers.get("X-Filename") ?? "arquivo");
    } catch {
      /* nome estranho: fica o padrão */
    }
    const att = await r.saveFile({
      name: name.replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "arquivo",
      type: (req.headers.get("Content-Type") ?? "application/octet-stream").slice(0, 100),
      width: Number(req.headers.get("X-Width")) || undefined,
      height: Number(req.headers.get("X-Height")) || undefined,
      data,
    });
    return json(att, 201);
  }

  m = rest.match(/^files\/([\w-]{1,64})$/);
  if (m && req.method === "GET") {
    const file = await r.file(m[1]);
    if (!file) throw new HttpError(404, "Arquivo não existe");
    const inline = /^(image|video|audio)\//.test(file.type) && file.type !== "image/svg+xml";
    return new Response(file.data, {
      headers: {
        ...cors,
        "Content-Type": file.type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  }

  m = rest.match(/^messages\/([\w-]{1,64})(?:\/(pin|reactions))?$/);
  if (m) {
    const [, mid, sub] = m;
    let msg: Message | null = null;
    if (!sub && req.method === "PATCH") {
      const b = await body<{ author: string; content: string }>(req);
      const content = String(b.content ?? "").trim();
      if (content.length > MAX_CONTENT) throw new HttpError(413, "Mensagem grande demais");
      msg = await r.edit(channelId, mid, cleanName(b.author), content);
    } else if (!sub && req.method === "DELETE") {
      const b = await body<{ author: string }>(req);
      await r.remove(mid, cleanName(b.author));
      await gw.publish("MESSAGE_DELETE", { id: mid, channelId }, to);
      return json({ ok: true });
    } else if (sub === "pin" && (req.method === "PUT" || req.method === "DELETE")) {
      msg = await r.pin(channelId, mid, req.method === "PUT");
    } else if (sub === "reactions" && (req.method === "PUT" || req.method === "DELETE")) {
      const b = await body<{ emoji: string; user: string }>(req);
      const emoji = String(b.emoji ?? "").slice(0, 32);
      const user = cleanName(b.user);
      if (!emoji || !user) throw new HttpError(400, "Faltou emoji ou usuário");
      msg = await r.react(channelId, mid, emoji, user, req.method === "PUT");
    } else throw new HttpError(405, "Método não suportado");
    await gw.publish("MESSAGE_UPDATE", msg, to);
    return json(msg);
  }

  throw new HttpError(404, "Não encontrado");
}

type MessageRow = {
  id: string;
  author: string;
  content: string;
  ts: number;
  edited_ts: number | null;
  pinned: number;
  attachments: string | null;
  reply: string | null;
};

/** Atravessa o RPC do Durable Object como texto; o Worker remonta o status. */
function fail(status: number, message: string): never {
  throw new Error(`HTTP ${status}: ${message}`);
}

/** Histórico de um canal de texto (ou conversa direta). */
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
    // Colunas que vieram depois da primeira versão
    for (const col of ["edited_ts INTEGER", "pinned INTEGER NOT NULL DEFAULT 0", "attachments TEXT", "reply TEXT"]) {
      try {
        this.sql.exec(`ALTER TABLE messages ADD COLUMN ${col}`);
      } catch {
        /* já existe */
      }
    }
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS reactions (
        message_id TEXT NOT NULL, emoji TEXT NOT NULL, user TEXT NOT NULL, ts INTEGER NOT NULL,
        PRIMARY KEY (message_id, emoji, user)
      )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL,
        width INTEGER, height INTEGER, data BLOB NOT NULL, message_id TEXT, created INTEGER NOT NULL
      )`
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  list(channelId: string, limit: number, before?: number): Message[] {
    const rows = before
      ? this.sql.exec<MessageRow>("SELECT * FROM messages WHERE ts < ? ORDER BY ts DESC LIMIT ?", before, limit)
      : this.sql.exec<MessageRow>("SELECT * FROM messages ORDER BY ts DESC LIMIT ?", limit);
    return this.hydrate(channelId, rows.toArray().reverse());
  }

  pins(channelId: string): Message[] {
    return this.hydrate(channelId, this.sql.exec<MessageRow>("SELECT * FROM messages WHERE pinned = 1 ORDER BY ts DESC").toArray());
  }

  search(channelId: string, q: string): Message[] {
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const rows = this.sql
      .exec<MessageRow>(
        "SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 25",
        like,
        like
      )
      .toArray();
    return this.hydrate(channelId, rows);
  }

  post(channelId: string, author: string, content: string, fileIds: string[], nonce?: string, replyId?: string): Message {
    const attachments = fileIds.map((id) => {
      const f = this.fileMeta(id);
      if (!f) fail(400, "Anexo não encontrado");
      return f!;
    });
    let reply: string | null = null;
    if (replyId) {
      const r = this.sql.exec<MessageRow>("SELECT * FROM messages WHERE id = ?", replyId).toArray()[0];
      if (r) reply = JSON.stringify({ id: r.id, author: r.author, content: r.content.slice(0, 120) });
    }
    // ts único e crescente: serve de ordem e de cursor pro ?before=
    const last = this.sql.exec<{ ts: number | null }>("SELECT MAX(ts) AS ts FROM messages").one().ts ?? 0;
    const ts = Math.max(Date.now(), last + 1);
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO messages (id, author, content, ts, nonce, attachments, reply) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      author,
      content,
      ts,
      nonce ?? null,
      attachments.length ? JSON.stringify(attachments) : null,
      reply
    );
    for (const a of attachments) this.sql.exec("UPDATE files SET message_id = ? WHERE id = ?", id, a.id);
    return { ...this.get(channelId, id), nonce };
  }

  edit(channelId: string, id: string, author: string, content: string): Message {
    const row = this.row(id);
    if (row.author !== author) fail(403, "Só quem mandou pode editar");
    if (!content && !row.attachments) fail(400, "Mensagem vazia");
    this.sql.exec("UPDATE messages SET content = ?, edited_ts = ? WHERE id = ?", content, Date.now(), id);
    return this.get(channelId, id);
  }

  remove(id: string, author: string) {
    const row = this.row(id);
    if (row.author !== author) fail(403, "Só quem mandou pode apagar");
    this.sql.exec("DELETE FROM messages WHERE id = ?", id);
    this.sql.exec("DELETE FROM reactions WHERE message_id = ?", id);
    this.sql.exec("DELETE FROM files WHERE message_id = ?", id);
  }

  pin(channelId: string, id: string, on: boolean): Message {
    this.row(id);
    this.sql.exec("UPDATE messages SET pinned = ? WHERE id = ?", on ? 1 : 0, id);
    return this.get(channelId, id);
  }

  react(channelId: string, id: string, emoji: string, user: string, on: boolean): Message {
    this.row(id);
    if (on) {
      const kinds = this.sql.exec<{ n: number }>("SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?", id).one().n;
      const exists = this.sql.exec("SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? LIMIT 1", id, emoji).toArray().length;
      if (!exists && kinds >= 20) fail(400, "Reações demais nessa mensagem");
      this.sql.exec("INSERT OR IGNORE INTO reactions (message_id, emoji, user, ts) VALUES (?, ?, ?, ?)", id, emoji, user, Date.now());
    } else this.sql.exec("DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND user = ?", id, emoji, user);
    return this.get(channelId, id);
  }

  saveFile(f: { name: string; type: string; width?: number; height?: number; data: ArrayBuffer }): Attachment {
    // Anexos que subiram e nunca foram usados numa mensagem (mais de 1 dia)
    this.sql.exec("DELETE FROM files WHERE message_id IS NULL AND created < ?", Date.now() - 86_400_000);
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO files (id, name, type, size, width, height, data, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      f.name,
      f.type,
      f.data.byteLength,
      f.width ?? null,
      f.height ?? null,
      f.data,
      Date.now()
    );
    return this.fileMeta(id)!;
  }

  file(id: string) {
    const row = this.sql
      .exec<{ name: string; type: string; data: ArrayBuffer }>("SELECT name, type, data FROM files WHERE id = ?", id)
      .toArray()[0];
    return row ?? null;
  }

  members(): string[] | undefined {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'members'").toArray()[0];
    return row ? (JSON.parse(row.v) as string[]) : undefined;
  }

  setMembers(members: string[]) {
    const current = this.members();
    if (current) return current;
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('members', ?)", JSON.stringify(members));
    return members;
  }

  async wipe() {
    await this.ctx.storage.deleteAll();
  }

  private fileMeta(id: string): Attachment | null {
    type Row = { id: string; name: string; type: string; size: number; width: number | null; height: number | null };
    const r = this.sql.exec<Row>("SELECT id, name, type, size, width, height FROM files WHERE id = ?", id).toArray()[0];
    if (!r) return null;
    return { id: r.id, name: r.name, type: r.type, size: r.size, width: r.width ?? undefined, height: r.height ?? undefined };
  }

  private row(id: string): MessageRow {
    const r = this.sql.exec<MessageRow>("SELECT * FROM messages WHERE id = ?", id).toArray()[0];
    if (!r) fail(404, "Mensagem não existe");
    return r;
  }

  private get(channelId: string, id: string): Message {
    return this.hydrate(channelId, [this.row(id)])[0];
  }

  /** Linhas → mensagens, com as reações agrupadas por emoji. */
  private hydrate(channelId: string, rows: MessageRow[]): Message[] {
    const reactions = new Map<string, Map<string, string[]>>();
    if (rows.length) {
      const marks = rows.map(() => "?").join(",");
      const list = this.sql.exec<{ message_id: string; emoji: string; user: string }>(
        `SELECT message_id, emoji, user FROM reactions WHERE message_id IN (${marks}) ORDER BY ts`,
        ...rows.map((r) => r.id)
      );
      for (const r of list) {
        const byEmoji = reactions.get(r.message_id) ?? new Map<string, string[]>();
        byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.user]);
        reactions.set(r.message_id, byEmoji);
      }
    }
    return rows.map((r) => {
      const msg: Message = { id: r.id, channelId, author: r.author, content: r.content, ts: r.ts };
      if (r.edited_ts) msg.editedTs = r.edited_ts;
      if (r.pinned) msg.pinned = true;
      if (r.attachments) msg.attachments = JSON.parse(r.attachments) as Attachment[];
      if (r.reply) msg.replyTo = JSON.parse(r.reply) as Message["replyTo"];
      const re = reactions.get(r.id);
      if (re) msg.reactions = [...re].map(([emoji, users]) => ({ emoji, users }));
      return msg;
    });
  }
}

/** Dados guardados em cada WebSocket (sobrevivem à hibernação do objeto). */
type WsAttachment = { at: number; sid?: string; name?: string };

type SessionRow = {
  id: string;
  name: string;
  voice: string | null;
  mute: number;
  deaf: number;
  online: number;
  seen: number;
  status: Status;
};

type ChannelRow = { id: string; name: string; kind: "text" | "voice"; topic: string | null; room: string | null; position: number };

/**
 * Gateway: conexões, sessões, presença e canais. Usa a API de hibernação, então
 * o objeto dorme entre eventos; o estado fica em SQLite e nos attachments.
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
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT, room TEXT, position INTEGER NOT NULL
      )`
    );
    for (const [table, col] of [
      ["sessions", "status TEXT NOT NULL DEFAULT 'online'"],
      // Destinatários do evento (JSON); null = todo mundo
      ["events", "rcpt TEXT"],
    ]) {
      try {
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
      } catch {
        /* já existe */
      }
    }
    if (!this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM channels").one().n) {
      for (const c of defaultChannels) {
        this.sql.exec(
          "INSERT INTO channels (id, name, kind, topic, room, position) VALUES (?, ?, ?, ?, ?, ?)",
          c.id,
          c.name,
          c.kind,
          c.topic ?? null,
          c.room ?? null,
          c.position
        );
      }
    }
    this.seq = this.sql.exec<{ v: number }>("SELECT v FROM meta WHERE k = 'seq'").toArray()[0]?.v ?? 0;
    // Heartbeat respondido pelo runtime, sem acordar o objeto
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT_ACK));
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ at: Date.now() } satisfies WsAttachment);
    send(server, { op: Op.Hello, d: { heartbeatInterval: HEARTBEAT_MS } });
    await this.armAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Chamado pelo Worker depois que o ChannelRoom mudou algo. */
  publish<K extends keyof DispatchMap>(t: K, d: DispatchMap[K], to?: string[]) {
    this.dispatch(t, d, to);
  }

  channels(): Channel[] {
    return this.sql
      .exec<ChannelRow>("SELECT * FROM channels ORDER BY kind DESC, position, name")
      .toArray()
      .map(toChannel);
  }

  channelKind(id: string): "text" | "voice" | null {
    return this.sql.exec<{ kind: "text" | "voice" }>("SELECT kind FROM channels WHERE id = ?", id).toArray()[0]?.kind ?? null;
  }

  createChannel(rawName: string, kind: "text" | "voice", rawTopic?: unknown): Channel {
    const name =
      kind === "text"
        ? rawName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40)
        : rawName.trim().slice(0, 40);
    if (!name) fail(400, "Dá um nome pro canal");
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM channels").one().n >= MAX_CHANNELS) fail(400, "Canais demais");
    const position =
      (this.sql.exec<{ p: number | null }>("SELECT MAX(position) AS p FROM channels WHERE kind = ?", kind).one().p ?? -1) + 1;
    const id = `${kind === "voice" ? "voz" : "txt"}-${crypto.randomUUID().slice(0, 8)}`;
    const topic = typeof rawTopic === "string" && rawTopic.trim() ? rawTopic.trim().slice(0, 120) : null;
    this.sql.exec(
      "INSERT INTO channels (id, name, kind, topic, room, position) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name,
      kind,
      topic,
      kind === "voice" ? id : null,
      position
    );
    const ch = toChannel(this.sql.exec<ChannelRow>("SELECT * FROM channels WHERE id = ?", id).one());
    this.dispatch("CHANNEL_CREATE", ch);
    return ch;
  }

  deleteChannel(id: string): Channel {
    const row = this.sql.exec<ChannelRow>("SELECT * FROM channels WHERE id = ?", id).toArray()[0];
    if (!row) fail(404, "Canal não existe");
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE kind = ?", row.kind).one().n <= 1) {
      fail(400, "Precisa sobrar pelo menos um canal desse tipo");
    }
    this.sql.exec("DELETE FROM channels WHERE id = ?", id);
    this.dispatch("CHANNEL_DELETE", { id });
    return toChannel(row);
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
    const att = attachment(ws);

    switch (p.op) {
      case Op.Heartbeat:
        // Heartbeat num formato diferente do fixo (o fixo nem chega aqui)
        ws.send(HEARTBEAT_ACK);
        return;

      case Op.Identify: {
        if (att.sid) return ws.close(Close.AlreadyAuthenticated, "Já identificado");
        const name = cleanName(p.d?.name);
        if (!name) return ws.close(Close.InvalidName, "Nome inválido");
        const status = STATUSES.includes(p.d?.status as Status) ? (p.d!.status as Status) : "online";
        this.sweepOrphans();
        const before = this.visibleStatus(name);
        const sid = crypto.randomUUID();
        this.sql.exec("INSERT INTO sessions (id, name, seen, status) VALUES (?, ?, ?, ?)", sid, name, Date.now(), status);
        ws.serializeAttachment({ ...att, sid, name } satisfies WsAttachment);
        send(ws, {
          op: Op.Dispatch,
          t: "READY",
          s: this.seq,
          d: { sessionId: sid, presences: this.presences(), voice: this.voiceStates(), channels: this.channels() },
        });
        this.presenceChanged(name, before);
        return;
      }

      case Op.PresenceUpdate: {
        if (!att.sid) return ws.close(Close.NotAuthenticated, "Mande IDENTIFY primeiro");
        const row = this.session(att.sid);
        if (!row) return ws.close(Close.SessionTimeout, "Sessão expirou");
        const status = STATUSES.includes(p.d?.status) ? p.d.status : "online";
        const before = this.visibleStatus(row.name);
        // Status é da pessoa, não da aba: vale pra todas as sessões com esse nome
        this.sql.exec("UPDATE sessions SET status = ? WHERE name = ?", status, row.name);
        this.presenceChanged(row.name, before);
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
          other.serializeAttachment({ at: Date.now() } satisfies WsAttachment);
          other.close(Close.SessionTimeout, "Sessão retomada em outra conexão");
        }
        const before = this.visibleStatus(row.name);
        this.sql.exec("UPDATE sessions SET online = 1, seen = ? WHERE id = ?", Date.now(), sid);
        ws.serializeAttachment({ ...att, sid, name: row.name } satisfies WsAttachment);
        const missedEvents = this.sql.exec<{ seq: number; t: string; d: string; rcpt: string | null }>(
          "SELECT seq, t, d, rcpt FROM events WHERE seq > ? ORDER BY seq",
          seq
        );
        for (const e of missedEvents) {
          if (e.rcpt && !(JSON.parse(e.rcpt) as string[]).includes(row.name)) continue;
          ws.send(`{"op":0,"t":${JSON.stringify(e.t)},"s":${e.seq},"d":${e.d}}`);
        }
        send(ws, { op: Op.Dispatch, t: "RESUMED", s: this.seq, d: null });
        this.presenceChanged(row.name, before);
        return;
      }

      case Op.Signal: {
        // Repassa a sinalização WebRTC só entre duas sessões no mesmo canal de voz
        if (!att.sid) return;
        const from = this.session(att.sid);
        const to = typeof p.d?.to === "string" ? this.session(p.d.to) : null;
        if (!from?.voice || !to || to.voice !== from.voice) return;
        const data = JSON.stringify(p.d.data ?? null);
        if (data.length > 64_000) return;
        const frame = `{"op":${Op.Signal},"d":{"from":${JSON.stringify(from.id)},"data":${data}}}`;
        for (const other of this.ctx.getWebSockets()) {
          if (attachment(other).sid !== to.id) continue;
          try {
            other.send(frame);
          } catch {
            /* caiu; o outro lado refaz a conexão */
          }
        }
        return;
      }

      case Op.Typing: {
        if (!att.sid || !att.name) return;
        const channelId = typeof p.d?.channelId === "string" ? p.d.channelId.slice(0, 64) : "";
        if (!channelId) return;
        const frame = JSON.stringify({ op: Op.Typing, d: { channelId, name: att.name } });
        for (const other of this.ctx.getWebSockets()) {
          const o = attachment(other);
          if (!o.sid || o.name === att.name) continue;
          try {
            other.send(frame);
          } catch {
            /* tanto faz */
          }
        }
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
      ws.serializeAttachment({ at: att.at } satisfies WsAttachment);
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
    const before = this.visibleStatus(row.name);
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
    this.presenceChanged(row.name, before);
  }

  private presenceChanged(name: string, before: VisibleStatus) {
    const now = this.visibleStatus(name);
    if (now !== before) this.dispatch("PRESENCE_UPDATE", { name, status: now });
  }

  /**
   * O que os outros veem. Sessão no período de graça ainda conta (evita piscar
   * offline num F5). Invisível = offline.
   */
  private visibleStatus(name: string): VisibleStatus {
    const set = new Set(
      this.sql
        .exec<{ status: Status }>("SELECT status FROM sessions WHERE name = ?", name)
        .toArray()
        .map((r) => r.status)
    );
    if (set.has("dnd")) return "dnd";
    if (set.has("online")) return "online";
    if (set.has("idle")) return "idle";
    return "offline";
  }

  private dispatch<K extends keyof DispatchMap>(t: K, d: DispatchMap[K], to?: string[]) {
    const s = ++this.seq;
    const data = JSON.stringify(d);
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('seq', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", s);
    this.sql.exec("INSERT INTO events (seq, t, d, rcpt) VALUES (?, ?, ?, ?)", s, t, data, to ? JSON.stringify(to) : null);
    this.sql.exec("DELETE FROM events WHERE seq <= ?", s - KEEP_EVENTS);
    const frame = `{"op":0,"t":${JSON.stringify(t)},"s":${s},"d":${data}}`;
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachment(ws);
      if (!att.sid) continue;
      // Quem não é destinatário recebe só o número (pra não achar que perdeu eventos)
      const out = to && !to.includes(att.name ?? "") ? `{"op":0,"t":"NOOP","s":${s},"d":null}` : frame;
      try {
        ws.send(out);
      } catch {
        /* conexão caindo; o RESUME repõe */
      }
    }
  }

  private session(id: string) {
    return this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id = ?", id).toArray()[0] ?? null;
  }

  private presences(): PresenceInfo[] {
    const names = this.sql.exec<{ name: string }>("SELECT DISTINCT name FROM sessions ORDER BY name").toArray();
    return names
      .map(({ name }) => ({ name, status: this.visibleStatus(name) }))
      .filter((p) => p.status !== "offline");
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

function toChannel(r: ChannelRow): Channel {
  const c: Channel = { id: r.id, name: r.name, kind: r.kind, position: r.position };
  if (r.topic) c.topic = r.topic;
  if (r.room) c.room = r.room;
  return c;
}

function attachment(ws: WebSocket) {
  return (ws.deserializeAttachment() ?? { at: 0 }) as WsAttachment;
}

function send(ws: WebSocket, p: ServerPayload) {
  ws.send(JSON.stringify(p));
}
