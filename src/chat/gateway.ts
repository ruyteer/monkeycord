import { HEARTBEAT, Op, type ClientPayload, type Dispatch, type ServerPayload } from "./protocol";

export type GatewayStatus = "connecting" | "ready" | "offline";

type Options = {
  url: string;
  name: string;
  onDispatch: (e: Dispatch) => void;
  onStatus?: (s: GatewayStatus) => void;
};

/**
 * Conexão com o gateway: heartbeat, IDENTIFY, RESUME e reconexão com espera
 * crescente. Caiu a rede ou o heartbeat ficou sem resposta: reconecta e tenta
 * retomar a sessão, recebendo os eventos que perdeu.
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private seq = 0;
  private ready = false;
  private acked = true;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private closed = false;

  constructor(private opts: Options) {
    window.addEventListener("online", this.reconnectNow);
  }

  connect() {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.ready = false;
    this.opts.onStatus?.("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      try {
        this.handle(JSON.parse(e.data as string) as ServerPayload);
      } catch (err) {
        console.warn("[gateway] payload estranho", err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.ready = false;
      if (this.closed) return;
      this.opts.onStatus?.("offline");
      // 1s, 2s, 4s... até 15s, com um pouco de aleatório pra não voltar todo mundo junto
      const wait = Math.min(1000 * 2 ** this.attempts++, 15_000) * (0.75 + Math.random() * 0.5);
      this.retry = setTimeout(() => this.connect(), wait);
    };
  }

  /** Só manda depois do READY/RESUMED; o que se perder é reenviado pela store ao reconectar. */
  send(p: ClientPayload) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(p));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.stopHeartbeat();
    window.removeEventListener("online", this.reconnectNow);
    // 1000 = saiu de propósito: o servidor encerra a sessão na hora
    this.ws?.close(1000);
    this.ws = null;
  }

  private reconnectNow = () => {
    if (this.closed || this.ready) return;
    this.attempts = 0;
    if (this.ws) this.ws.close(4000);
    else this.connect();
  };

  private handle(p: ServerPayload) {
    switch (p.op) {
      case Op.Hello:
        this.startHeartbeat(p.d.heartbeatInterval);
        if (this.sessionId) this.raw({ op: Op.Resume, d: { sessionId: this.sessionId, seq: this.seq } });
        else this.raw({ op: Op.Identify, d: { name: this.opts.name } });
        return;
      case Op.HeartbeatAck:
        this.acked = true;
        return;
      case Op.InvalidSession:
        // Sessão expirou: começa do zero (a store recarrega o histórico no READY)
        this.sessionId = null;
        this.seq = 0;
        setTimeout(() => this.raw({ op: Op.Identify, d: { name: this.opts.name } }), 500 + Math.random() * 1500);
        return;
      case Op.Reconnect:
        this.ws?.close(4000);
        return;
      case Op.Dispatch:
        this.seq = Math.max(this.seq, p.s);
        if (p.t === "READY") {
          this.sessionId = p.d.sessionId;
          this.seq = p.s;
        }
        if (p.t === "READY" || p.t === "RESUMED") {
          this.ready = true;
          this.attempts = 0;
          this.opts.onStatus?.("ready");
        }
        this.opts.onDispatch(p);
        return;
    }
  }

  private startHeartbeat(interval: number) {
    this.stopHeartbeat();
    this.acked = true;
    const beat = () => {
      const ws = this.ws;
      if (!ws) return;
      if (!this.acked) {
        // Não respondeu o último: conexão zumbi. Fecha com código != 1000 pra poder retomar.
        ws.close(4000, "Sem resposta do heartbeat");
        return;
      }
      this.acked = false;
      ws.send(HEARTBEAT);
      this.heartbeat = setTimeout(beat, interval);
    };
    // Primeiro com atraso aleatório, igual ao Discord
    this.heartbeat = setTimeout(beat, interval * Math.random());
  }

  private stopHeartbeat() {
    clearTimeout(this.heartbeat);
  }

  private raw(p: ClientPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(p));
  }
}
