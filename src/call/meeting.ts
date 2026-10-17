/**
 * Chamada de voz/vídeo/tela P2P (WebRTC "mesh"), sem servidor de mídia pago.
 *
 * Cada pessoa do canal de voz se liga direto em cada uma das outras. O
 * gateway do chat (Worker) só apresenta um ao outro (sinalização) e diz quem
 * está no canal (VOICE_STATE). Áudio, vídeo e tela vão de PC pra PC.
 *
 * Bom pra grupo de amigos: até ~8 pessoas com voz e algumas câmeras/telas.
 * Quem compartilha a tela manda uma cópia pra cada pessoa, então a internet de
 * upload dele é o limite.
 *
 * A forma da API (self, participants.joined, eventos) imita a do RealtimeKit
 * que o app usava antes, pra interface não precisar mudar.
 */
import {
  getIceServers,
  getPresence,
  getSessionId,
  onSignal,
  sendSignal,
  subscribeChat,
  updateVoiceState,
} from "@/chat/store";
import { cameraConstraints, getPrefs, micConstraints } from "./devices";

export const isMobile =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/* ---------- Compartilhamento de tela pensado pra filme ---------- */

/**
 * - 1080p a 30fps; contentHint "motion": o encoder prefere manter o fps;
 * - áudio da aba/sistema sem processamento de voz (eco/ruído/ganho distorcem música).
 */
let patched = false;
function patchDisplayMedia() {
  const md = navigator.mediaDevices;
  if (patched || !md?.getDisplayMedia) return;
  patched = true;
  const original = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = async (constraints: DisplayMediaStreamOptions = {}) => {
    const video = typeof constraints.video === "object" ? constraints.video : {};
    const stream = await original({
      ...constraints,
      video: {
        ...video,
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000,
      },
      // Chrome: permite marcar "compartilhar áudio" e trocar de aba no meio
      systemAudio: "include",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude",
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks().forEach((t) => (t.contentHint = "motion"));
    stream.getAudioTracks().forEach((t) => (t.contentHint = "music"));
    return stream;
  };
}
if (typeof navigator !== "undefined") patchDisplayMedia();

/* ---------- Eventos ---------- */

type Handler = (...args: never[]) => void;

class Emitter {
  private handlers = new Map<string, Set<Handler>>();
  on(event: string, fn: (...args: never[]) => void) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(fn);
    this.handlers.set(event, set);
  }
  off(event: string, fn: (...args: never[]) => void) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  }
}

/** O que cada lado manda pelo canal de dados: em qual faixa está cada coisa e o estado. */
/**
 * Cada faixa é identificada pelo `mid` dela na conexão (fixo, não muda quando a
 * faixa é reaproveitada). Por stream não dá: o Chrome do outro lado não move a
 * faixa recebida pro stream novo quando ela é reaproveitada.
 */
type PeerState = {
  name: string;
  audio: boolean;
  mic: string | null;
  cam: string | null;
  screenVideo: string | null;
  screenAudio: string | null;
};

/**
 * gen = id da conexão de quem mandou (muda quando ela é refeita), pra
 * descartar sinal atrasado de uma conexão velha. reset = "refiz a minha, refaz a sua".
 */
type Signal = {
  gen?: string;
  reset?: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

/** Sem conectar nesse tempo, a conexão com a pessoa é refeita do zero. */
const CONNECT_TIMEOUT = 12_000;

/* ---------- Participantes ---------- */

export class Participant extends Emitter {
  audioEnabled = false;
  videoEnabled = false;
  screenShareEnabled = false;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack } = {};
  constructor(
    public id: string,
    public name: string
  ) {
    super();
  }
}

class Self extends Participant {
  constructor(private call: Meeting) {
    super("self", call.name);
  }
  enableAudio() {
    return this.call.setMic(true);
  }
  disableAudio() {
    return this.call.setMic(false);
  }
  enableVideo() {
    return this.call.setCamera(true);
  }
  disableVideo() {
    return this.call.setCamera(false);
  }
  enableScreenShare() {
    return this.call.setScreen(true);
  }
  disableScreenShare() {
    return this.call.setScreen(false);
  }
}

class Joined extends Emitter {
  map = new Map<string, Participant>();
  toArray() {
    return [...this.map.values()];
  }
}

/** Uma conexão com outra pessoa ("perfect negotiation" do WebRTC: os dois lados podem oferecer). */
class Peer {
  pc: RTCPeerConnection;
  ctl: RTCDataChannel;
  makingOffer = false;
  ignoreOffer = false;
  remote: PeerState | null = null;
  senders = new Map<MediaStreamTrack, RTCRtpTransceiver>();
  /** Faixas que este lado criou pra enviar (só elas são reaproveitadas; as do outro lado ficam com ele) */
  private own = new Set<RTCRtpTransceiver>();
  restartTimer?: number;
  /** Sinais processados um de cada vez, na ordem em que chegaram */
  private queue: Promise<void> = Promise.resolve();
  /** Id desta conexão e da conexão do outro lado (ver Signal.gen) */
  gen = crypto.randomUUID().slice(0, 8);
  /** Bytes de vídeo da última medição (pra calcular kbps) */
  lastBytes?: { at: number; inBytes: number; outBytes: number };
  theirGen: string | null = null;
  private connectTimer?: number;

  constructor(
    public id: string,
    public polite: boolean,
    iceServers: RTCIceServer[],
    private call: Meeting
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
    // Canal combinado dos dois lados (mesmo id): já dispara a primeira negociação
    this.ctl = this.pc.createDataChannel("ctl", { negotiated: true, id: 0 });
    this.ctl.onopen = () => this.sendState();
    this.ctl.onmessage = (e) => {
      try {
        this.remote = JSON.parse(e.data as string) as PeerState;
        this.call.refreshPeer(this);
      } catch {
        /* lixo */
      }
    };

    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = ({ candidate }) => this.signal({ candidate: candidate?.toJSON() ?? null });
    // Negociação terminou: os mids novos já existem dos dois lados
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState !== "stable") return;
      this.sendState();
      this.call.refreshPeer(this);
    };
    this.pc.ontrack = ({ track }) => {
      track.onunmute = () => this.call.refreshPeer(this);
      this.call.refreshPeer(this);
    };
    // Não conectou a tempo (sinal perdido, rede ruim): quem não é "educado" refaz tudo
    this.connectTimer = window.setTimeout(() => {
      if (this.pc.connectionState !== "connected" && !this.polite) this.call.resetPeer(this.id, true);
    }, CONNECT_TIMEOUT + Math.random() * 2000);

    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === "connected") window.clearTimeout(this.connectTimer);
      if (st === "failed") this.pc.restartIce();
      // "disconnected" às vezes volta sozinho; se não voltar em 5s, tenta de novo
      window.clearTimeout(this.restartTimer);
      if (st === "disconnected") this.restartTimer = window.setTimeout(() => this.pc.restartIce(), 5000);
      this.call.refreshPeer(this);
    };
  }

  signal(data: Signal) {
    sendSignal(this.id, { ...data, gen: this.gen });
  }

  private stuckTimer?: number;

  /** Manda uma oferta. Se a resposta não vier (sinal perdido), desfaz e tenta de novo. */
  private async negotiate() {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.signal({ description: this.pc.localDescription!.toJSON() });
    } catch (err) {
      console.warn("[voz] negociação", err);
    } finally {
      this.makingOffer = false;
    }
    window.clearTimeout(this.stuckTimer);
    const offer = this.pc.localDescription?.sdp;
    this.stuckTimer = window.setTimeout(() => {
      if (this.pc.signalingState !== "have-local-offer" || this.pc.localDescription?.sdp !== offer) return;
      console.warn("[voz] oferta sem resposta, tentando de novo");
      void this.queue.then(async () => {
        if (this.pc.signalingState !== "have-local-offer") return;
        await this.pc.setLocalDescription({ type: "rollback" }).catch(() => {});
        await this.negotiate();
      });
    }, 6000 + Math.random() * 2000);
  }

  receive(data: Signal) {
    this.queue = this.queue.then(() => this.handle(data));
    return this.queue;
  }

  private async handle(data: Signal) {
    const { description, candidate } = data;
    try {
      if (description) {
        const collision = description.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription({ type: description.type, sdp: stereoOpus(description.sdp ?? "") });
        if (description.type === "offer") {
          await this.pc.setLocalDescription();
          this.signal({ description: this.pc.localDescription!.toJSON() });
        }
      } else if (candidate !== undefined) {
        try {
          await this.pc.addIceCandidate(candidate ?? undefined);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn("[voz] sinal", err);
    }
  }

  sendState() {
    if (this.ctl.readyState === "open") this.ctl.send(JSON.stringify(this.call.localState(this)));
  }

  /**
   * Manda uma faixa (mic, câmera, tela). Reaproveita uma faixa da conexão que
   * esteja parada em vez de criar outra: senão cada liga/desliga de câmera ou
   * tela deixa a negociação ~7 KB maior pra sempre, até passar do limite do
   * gateway e a transmissão nova nunca chegar pra essa pessoa.
   */
  addTrack(track: MediaStreamTrack, stream: MediaStream, maxBitrate?: number) {
    if (this.senders.has(track)) return;
    const used = new Set(this.senders.values());
    const idle = [...this.own].find(
      (t) =>
        !used.has(t) &&
        t.currentDirection !== "stopped" &&
        t.sender.track == null &&
        t.receiver.track.kind === track.kind &&
        t.direction === "inactive"
    );
    if (idle) {
      void idle.sender.replaceTrack(track);
      idle.sender.setStreams(stream);
      idle.direction = "sendonly";
      if (maxBitrate) {
        const params = idle.sender.getParameters();
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = maxBitrate;
          if (track.kind === "video") params.encodings[0].maxFramerate = 30;
          void idle.sender.setParameters(params).catch(() => {});
        }
      }
      this.senders.set(track, idle);
      return;
    }
    const t = this.pc.addTransceiver(track, {
      // Só de ida: cada lado manda nas suas faixas (o outro não pega carona nelas)
      direction: "sendonly",
      streams: [stream],
      sendEncodings: maxBitrate ? [{ maxBitrate, ...(track.kind === "video" ? { maxFramerate: 30 } : {}) }] : undefined,
    });
    this.senders.set(track, t);
    this.own.add(t);
  }

  /** Para de mandar a faixa e deixa ela livre pra próxima vez (ver addTrack). */
  removeTrack(track: MediaStreamTrack) {
    const t = this.senders.get(track);
    if (!t) return;
    this.senders.delete(track);
    try {
      void t.sender.replaceTrack(null);
      t.direction = "inactive";
    } catch {
      /* conexão já fechada */
    }
  }

  close() {
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.stuckTimer);
    window.clearTimeout(this.connectTimer);
    this.pc.onnegotiationneeded = this.pc.onicecandidate = this.pc.ontrack = null;
    this.pc.onconnectionstatechange = this.pc.onsignalingstatechange = null;
    this.ctl.close();
    this.pc.close();
  }
}

/** Abre o Opus em estéreo e com mais bitrate (música/filme na tela sai bem melhor). */
function stereoOpus(sdp: string) {
  return sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt: string, params: string) =>
    /stereo=1/.test(params) ? line : `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`
  );
}

/* ---------- A chamada ---------- */

export class Meeting {
  self: Self;
  participants: Joined & { joined: Joined };
  peers = new Map<string, Peer>();
  private mySid: string | null = null;
  private joinedChannel = false;
  private iceServers: RTCIceServer[] = [];
  private unsubs: (() => void)[] = [];
  private mic: { stream: MediaStream; raw: MediaStream; gain?: AudioContext } | null = null;
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private meter: SpeakingMeter;

  constructor(
    public channelId: string,
    public name: string
  ) {
    this.self = new Self(this);
    const joined = new Joined();
    this.participants = Object.assign(joined, { joined });
    this.meter = new SpeakingMeter((peerId, volume) => this.participants.emit("activeSpeaker", { peerId, volume }));
  }

  /** Entra no canal: pega o microfone (se for pra ligar) e começa a ligar nos outros. */
  async join(opts: { audio: boolean; muted: boolean; deafened: boolean }) {
    this.iceServers = await getIceServers();
    if (opts.audio) await this.setMic(true).catch(() => {});
    this.joinedChannel = true;
    this.unsubs.push(onSignal((from, data) => this.onSignal(from, data as Signal)));
    this.unsubs.push(subscribeChat(() => this.sync()));
    // Avisa o gateway que está no canal ANTES de mandar qualquer sinal: ele só
    // repassa sinal entre quem está no mesmo canal, e descartava a primeira
    // oferta (os dois lados ficavam esperando resposta pra sempre).
    updateVoiceState(this.channelId, opts.muted, opts.deafened);
    this.sync();
    this.self.emit("roomJoined");
  }

  async leave() {
    if (!this.joinedChannel) return;
    this.joinedChannel = false;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    for (const s of [this.mic?.raw, this.mic?.stream, this.cam, this.screen]) s?.getTracks().forEach((t) => t.stop());
    void this.mic?.gain?.close();
    this.mic = this.cam = this.screen = null;
    this.meter.stop();
  }

  /** Confere quem está no canal (pela presença do gateway) e liga/desliga conexões. */
  private sync() {
    if (!this.joinedChannel) return;
    const sid = getSessionId();
    if (!sid) return;
    if (sid !== this.mySid) {
      // Sessão nova no gateway (reconectou do zero): refaz tudo com o id novo
      for (const id of [...this.peers.keys()]) this.dropPeer(id);
      this.mySid = sid;
      this.self.id = sid;
      if (this.mic) this.meter.watch(sid, this.mic.stream);
    }
    const here = getPresence().voice.filter((v) => v.channelId === this.channelId && v.sessionId !== sid);
    const ids = new Set(here.map((v) => v.sessionId));
    for (const v of here) {
      if (!this.peers.has(v.sessionId)) this.addPeer(v.sessionId, v.name);
      const p = this.participants.joined.map.get(v.sessionId);
      if (p && p.name !== v.name) p.name = v.name;
    }
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.dropPeer(id);
  }

  private newPeer(id: string) {
    const peer = new Peer(id, this.mySid! < id, this.iceServers, this);
    this.peers.set(id, peer);
    for (const [track, stream, rate] of this.localTracks()) peer.addTrack(track, stream, rate);
    return peer;
  }

  /**
   * Refaz a conexão com uma pessoa sem tirar ela da chamada. initiator = fui eu
   * que desisti (aviso o outro lado pra refazer a dele também).
   */
  resetPeer(id: string, initiator: boolean, theirGen?: string) {
    if (!this.joinedChannel || !this.peers.has(id)) return;
    console.warn("[voz] refazendo a conexão com", id.slice(0, 6));
    this.peers.get(id)!.close();
    this.meter.unwatch(id);
    const peer = this.newPeer(id);
    if (theirGen) peer.theirGen = theirGen;
    if (initiator) peer.signal({ reset: true });
    const p = this.participants.joined.map.get(id);
    if (p) this.refreshPeer(peer);
    return peer;
  }

  private addPeer(id: string, name: string) {
    const peer = this.newPeer(id);
    const p = new Participant(id, name);
    this.participants.joined.map.set(id, p);
    this.participants.joined.emit("participantJoined", p);
    return peer;
  }

  private dropPeer(id: string) {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.meter.unwatch(id);
    const p = this.participants.joined.map.get(id);
    this.participants.joined.map.delete(id);
    if (p) this.participants.joined.emit("participantLeft", p);
  }

  private onSignal(from: string, data: Signal) {
    if (import.meta.env.DEV) {
      console.debug("[voz] sinal de", from.slice(0, 6), data.description?.type ?? (data.candidate ? "candidate" : "fim"), this.peers.has(from));
    }
    if (!this.joinedChannel) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // O outro viu você antes de você ver ele: só aceita se ele estiver no canal
      const v = getPresence().voice.find((x) => x.sessionId === from && x.channelId === this.channelId);
      if (!v || !this.mySid) {
        console.warn("[voz] sinal descartado de", from.slice(0, 6), { naPresenca: !!v, mySid: this.mySid });
        return;
      }
      peer = this.addPeer(from, v.name);
    }
    // Conexão do outro lado foi refeita: refaz a minha também
    if (data.reset) {
      this.resetPeer(from, false, data.gen);
      return;
    }
    if (data.gen) {
      if (!peer.theirGen) peer.theirGen = data.gen;
      else if (peer.theirGen !== data.gen) {
        // Oferta de uma conexão nova do outro lado (ele recarregou/refez): acompanha
        if (data.description?.type === "offer") peer = this.resetPeer(from, false, data.gen) ?? peer;
        else return; // sinal atrasado de uma conexão velha
      }
    }
    void peer.receive(data);
  }

  /** Atualiza um participante a partir do que chegou da conexão. */
  refreshPeer(peer: Peer) {
    const p = this.participants.joined.map.get(peer.id);
    if (!p) return;
    const st = peer.remote;
    const transceivers = peer.pc.getTransceivers();
    const pick = (mid: string | null | undefined, kind: "audio" | "video") => {
      if (!mid) return undefined;
      const t = transceivers.find((x) => x.mid === mid);
      const track = t?.receiver.track;
      const receiving = t?.currentDirection === "recvonly" || t?.currentDirection === "sendrecv";
      return track && receiving && track.kind === kind && track.readyState === "live" ? track : undefined;
    };

    const before = [p.audioEnabled, p.videoEnabled, p.screenShareEnabled, p.audioTrack, p.videoTrack, p.screenShareTracks.video, p.screenShareTracks.audio];
    if (st) p.name = st.name;
    p.audioTrack = pick(st?.mic, "audio");
    p.audioEnabled = !!st?.audio && !!p.audioTrack;
    p.videoTrack = pick(st?.cam, "video");
    p.videoEnabled = !!p.videoTrack;
    p.screenShareTracks = { video: pick(st?.screenVideo, "video"), audio: pick(st?.screenAudio, "audio") };
    p.screenShareEnabled = !!p.screenShareTracks.video;
    const after = [p.audioEnabled, p.videoEnabled, p.screenShareEnabled, p.audioTrack, p.videoTrack, p.screenShareTracks.video, p.screenShareTracks.audio];

    if (p.audioTrack) this.meter.watch(peer.id, new MediaStream([p.audioTrack]));
    else this.meter.unwatch(peer.id);
    if (before.some((v, i) => v !== after[i])) {
      this.participants.joined.emit("audioUpdate", p);
      this.participants.joined.emit("videoUpdate", p);
      this.participants.joined.emit("screenShareUpdate", p);
    }
  }

  /** O que eu mando pra essa pessoa e em qual faixa (mid) de cada coisa. */
  localState(peer: Peer): PeerState {
    const mid = (t?: MediaStreamTrack) => (t ? (peer.senders.get(t)?.mid ?? null) : null);
    return {
      name: this.name,
      audio: this.self.audioEnabled,
      mic: mid(this.mic?.stream.getAudioTracks()[0]),
      cam: mid(this.cam?.getVideoTracks()[0]),
      screenVideo: mid(this.screen?.getVideoTracks()[0]),
      screenAudio: mid(this.screen?.getAudioTracks()[0]),
    };
  }

  private localTracks(): [MediaStreamTrack, MediaStream, number | undefined][] {
    const out: [MediaStreamTrack, MediaStream, number | undefined][] = [];
    if (this.mic) out.push([this.mic.stream.getAudioTracks()[0], this.mic.stream, undefined]);
    if (this.cam) out.push([this.cam.getVideoTracks()[0], this.cam, 1_500_000]);
    if (this.screen) {
      for (const t of this.screen.getTracks()) out.push([t, this.screen, t.kind === "video" ? 4_500_000 : 128_000]);
    }
    return out.filter(([t]) => !!t);
  }

  private broadcast() {
    for (const peer of this.peers.values()) peer.sendState();
  }

  private addEverywhere(track: MediaStreamTrack, stream: MediaStream, rate?: number) {
    for (const peer of this.peers.values()) peer.addTrack(track, stream, rate);
  }

  private removeEverywhere(stream: MediaStream | null) {
    stream?.getTracks().forEach((t) => {
      for (const peer of this.peers.values()) peer.removeTrack(t);
      t.stop();
    });
  }

  /** Microfone: a primeira vez pede permissão; depois mutar só silencia (volta na hora, igual ao Discord). */
  async setMic(on: boolean) {
    if (on && !this.mic) {
      const raw = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
      const gain = getPrefs().inputGain;
      let stream = raw;
      let ctx: AudioContext | undefined;
      if (gain !== 100) {
        // Volume de entrada diferente de 100%: passa pelo Web Audio com ganho
        ctx = new AudioContext();
        const g = ctx.createGain();
        g.gain.value = gain / 100;
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(raw).connect(g).connect(dest);
        stream = dest.stream;
      }
      this.mic = { stream, raw, gain: ctx };
      const track = stream.getAudioTracks()[0];
      this.addEverywhere(track, stream);
      this.self.audioTrack = track;
      if (this.mySid) this.meter.watch(this.mySid, stream);
    }
    if (this.mic) this.mic.stream.getAudioTracks().forEach((t) => (t.enabled = on));
    this.self.audioEnabled = on && !!this.mic;
    this.broadcast();
    this.self.emit("audioUpdate");
  }

  /** Troca o microfone (mudou nas configurações) sem renegociar. */
  async restartMic() {
    if (!this.mic) return;
    const was = this.self.audioEnabled;
    const old = this.mic;
    this.mic = null;
    for (const peer of this.peers.values()) old.stream.getTracks().forEach((t) => peer.removeTrack(t));
    old.raw.getTracks().forEach((t) => t.stop());
    old.stream.getTracks().forEach((t) => t.stop());
    void old.gain?.close();
    await this.setMic(true);
    if (!was) await this.setMic(false);
  }

  async setCamera(on: boolean) {
    if (on && !this.cam) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(isMobile) });
      this.cam = stream;
      this.addEverywhere(stream.getVideoTracks()[0], stream, 1_500_000);
    } else if (!on && this.cam) {
      this.removeEverywhere(this.cam);
      this.cam = null;
    }
    this.self.videoTrack = this.cam?.getVideoTracks()[0];
    this.self.videoEnabled = !!this.cam;
    this.broadcast();
    this.self.emit("videoUpdate");
  }

  async setScreen(on: boolean) {
    if (on && !this.screen) {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.screen = stream;
      for (const t of stream.getTracks()) {
        this.addEverywhere(t, stream, t.kind === "video" ? 4_500_000 : 128_000);
        // "Parar de compartilhar" do navegador/Windows
        t.addEventListener("ended", () => {
          if (this.screen === stream && t.kind === "video") void this.setScreen(false);
        });
      }
    } else if (!on && this.screen) {
      this.removeEverywhere(this.screen);
      this.screen = null;
    }
    this.self.screenShareTracks = {
      video: this.screen?.getVideoTracks()[0],
      audio: this.screen?.getAudioTracks()[0],
    };
    this.self.screenShareEnabled = !!this.screen;
    this.broadcast();
    this.self.emit("screenShareUpdate");
  }

  /**
   * Qualidade da conexão com cada pessoa: ping, se é direta ou passa por um
   * servidor TURN, e quanto está chegando/saindo de vídeo.
   */
  async stats() {
    const out: {
      id: string;
      name: string;
      rtt?: number;
      state: RTCPeerConnectionState;
      route?: "direta" | "turn";
      inKbps: number;
      outKbps: number;
    }[] = [];
    for (const [id, peer] of this.peers) {
      let rtt: number | undefined;
      let route: "direta" | "turn" | undefined;
      let inBytes = 0;
      let outBytes = 0;
      const report = await peer.pc.getStats().catch(() => null);
      const byId = new Map<string, Record<string, unknown>>();
      report?.forEach((r) => byId.set(r.id, r));
      report?.forEach((r) => {
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
          if (r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
          const local = byId.get(r.localCandidateId);
          route = local?.candidateType === "relay" ? "turn" : "direta";
        }
        if (r.type === "inbound-rtp" && r.kind === "video") inBytes += r.bytesReceived ?? 0;
        if (r.type === "outbound-rtp" && r.kind === "video") outBytes += r.bytesSent ?? 0;
      });
      const now = performance.now();
      const prev = peer.lastBytes;
      peer.lastBytes = { at: now, inBytes, outBytes };
      const secs = prev ? (now - prev.at) / 1000 : 0;
      out.push({
        id,
        name: this.participants.joined.map.get(id)?.name ?? "?",
        rtt,
        state: peer.pc.connectionState,
        route,
        inKbps: secs ? Math.max(0, ((inBytes - prev!.inBytes) * 8) / 1000 / secs) : 0,
        outKbps: secs ? Math.max(0, ((outBytes - prev!.outBytes) * 8) / 1000 / secs) : 0,
      });
    }
    return out;
  }
}

/** Quem está falando: mede o volume de cada áudio umas 6 vezes por segundo. */
class SpeakingMeter {
  private ctx: AudioContext | null = null;
  private nodes = new Map<string, { track: MediaStreamTrack; analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>();
  private timer = 0;
  private buf = new Uint8Array(512);

  constructor(private onLevel: (peerId: string, volume: number) => void) {}

  watch(id: string, stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track || this.nodes.get(id)?.track === track) return;
    this.unwatch(id);
    this.ctx ??= new AudioContext();
    void this.ctx.resume().catch(() => {});
    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.nodes.set(id, { track, analyser, source });
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 160);
  }

  unwatch(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.source.disconnect();
    this.nodes.delete(id);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.nodes.forEach((_n, id) => this.unwatch(id));
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private tick() {
    for (const [id, { track, analyser }] of this.nodes) {
      if (!track.enabled || track.readyState !== "live") continue;
      analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / this.buf.length);
      if (rms > 4) this.onLevel(id, Math.min(100, rms * 4));
    }
  }
}
