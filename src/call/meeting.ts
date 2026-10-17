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
import { getIceServers, getPresence, getSessionId, onSignal, sendSignal, subscribeChat } from "@/chat/store";
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

/** O que cada lado manda pelo canal de dados: quais streams são o quê e o estado. */
type PeerState = {
  name: string;
  audio: boolean;
  mic: string | null;
  cam: string | null;
  screen: string | null;
};

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };

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
  streams = new Map<string, MediaStream>();
  remote: PeerState | null = null;
  senders = new Map<MediaStreamTrack, RTCRtpSender>();
  restartTimer?: number;

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

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.signal({ description: this.pc.localDescription!.toJSON() });
      } catch (err) {
        console.warn("[voz] negociação", err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onicecandidate = ({ candidate }) => this.signal({ candidate: candidate?.toJSON() ?? null });
    this.pc.ontrack = ({ track, streams }) => {
      const stream = streams[0];
      if (!stream) return;
      this.streams.set(stream.id, stream);
      stream.onremovetrack = () => this.call.refreshPeer(this);
      track.onunmute = () => this.call.refreshPeer(this);
      this.call.refreshPeer(this);
    };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === "failed") this.pc.restartIce();
      // "disconnected" às vezes volta sozinho; se não voltar em 5s, tenta de novo
      window.clearTimeout(this.restartTimer);
      if (st === "disconnected") this.restartTimer = window.setTimeout(() => this.pc.restartIce(), 5000);
      this.call.refreshPeer(this);
    };
  }

  signal(data: Signal) {
    sendSignal(this.id, data);
  }

  async receive(data: Signal) {
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
    if (this.ctl.readyState === "open") this.ctl.send(JSON.stringify(this.call.localState()));
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream, maxBitrate?: number) {
    if (this.senders.has(track)) return;
    const t = this.pc.addTransceiver(track, {
      direction: "sendrecv",
      streams: [stream],
      sendEncodings: maxBitrate ? [{ maxBitrate, maxFramerate: 30 }] : undefined,
    });
    this.senders.set(track, t.sender);
  }

  removeTrack(track: MediaStreamTrack) {
    const sender = this.senders.get(track);
    if (!sender) return;
    this.senders.delete(track);
    try {
      this.pc.removeTrack(sender);
    } catch {
      /* conexão já fechada */
    }
  }

  close() {
    window.clearTimeout(this.restartTimer);
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
  private peers = new Map<string, Peer>();
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
  async join(opts: { audio: boolean }) {
    this.iceServers = await getIceServers();
    if (opts.audio) await this.setMic(true).catch(() => {});
    this.joinedChannel = true;
    this.unsubs.push(onSignal((from, data) => this.onSignal(from, data as Signal)));
    this.unsubs.push(subscribeChat(() => this.sync()));
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

  private addPeer(id: string, name: string) {
    const peer = new Peer(id, this.mySid! < id, this.iceServers, this);
    this.peers.set(id, peer);
    for (const [track, stream, rate] of this.localTracks()) peer.addTrack(track, stream, rate);
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
    if (!this.joinedChannel) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // O outro viu você antes de você ver ele: só aceita se ele estiver no canal
      const v = getPresence().voice.find((x) => x.sessionId === from && x.channelId === this.channelId);
      if (!v || !this.mySid) return;
      peer = this.addPeer(from, v.name);
    }
    void peer.receive(data);
  }

  /** Atualiza um participante a partir do que chegou da conexão. */
  refreshPeer(peer: Peer) {
    const p = this.participants.joined.map.get(peer.id);
    if (!p) return;
    const st = peer.remote;
    const live = (t?: MediaStreamTrack) => (t && t.readyState === "live" ? t : undefined);
    const pick = (id: string | null | undefined, kind: "audio" | "video") =>
      id ? live(peer.streams.get(id)?.getTracks().find((t) => t.kind === kind)) : undefined;

    const before = [p.audioEnabled, p.videoEnabled, p.screenShareEnabled, p.audioTrack, p.videoTrack, p.screenShareTracks.video, p.screenShareTracks.audio];
    if (st) p.name = st.name;
    p.audioTrack = pick(st?.mic, "audio");
    p.audioEnabled = !!st?.audio && !!p.audioTrack;
    p.videoTrack = pick(st?.cam, "video");
    p.videoEnabled = !!p.videoTrack;
    p.screenShareTracks = { video: pick(st?.screen, "video"), audio: pick(st?.screen, "audio") };
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

  localState(): PeerState {
    return {
      name: this.name,
      audio: this.self.audioEnabled,
      mic: this.mic?.stream.id ?? null,
      cam: this.cam?.id ?? null,
      screen: this.screen?.id ?? null,
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

  /** Qualidade da conexão com cada pessoa (pra mostrar o ping). */
  async stats() {
    const out: { id: string; rtt?: number; state: RTCPeerConnectionState }[] = [];
    for (const [id, peer] of this.peers) {
      let rtt: number | undefined;
      const report = await peer.pc.getStats().catch(() => null);
      report?.forEach((r) => {
        if (r.type === "candidate-pair" && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
      });
      out.push({ id, rtt, state: peer.pc.connectionState });
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
