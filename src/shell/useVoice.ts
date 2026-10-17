import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Meeting } from "@/call/meeting";
import { playSound } from "@/call/sounds";
import { getIceServers } from "@/chat/store";
import type { Channel } from "./data";

export type VoiceState =
  | { status: "idle" }
  | { status: "connecting"; channel: Channel }
  | { status: "connected"; channel: Channel; meeting: Meeting };

/**
 * Conexão de voz estilo Discord: um canal por vez, entra com um clique e
 * continua conectado enquanto você navega pelos canais de texto.
 * Mudo/surdo valem antes e durante a chamada.
 */
export function useVoice(name: string) {
  const [state, setState] = useState<VoiceState>({ status: "idle" });
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const deafRef = useRef(deafened);
  deafRef.current = deafened;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Cada join/leave ganha um número; respostas atrasadas de um join antigo são descartadas
  const seq = useRef(0);
  // Mouse em cima do canal: já busca os servidores STUN/TURN, o clique só liga
  const prefetch = useCallback((_channel: Channel) => void getIceServers(), []);

  // Mudo/surdo atuais, lidos na hora de entrar
  const micWanted = useRef(true);
  micWanted.current = !muted && !deafened;

  const leave = useCallback(async () => {
    const s = stateRef.current;
    seq.current++;
    stateRef.current = { status: "idle" };
    setState(stateRef.current);
    if (s.status === "connected") {
      playSound("selfLeave");
      await s.meeting.leave().catch(() => {});
    }
  }, []);

  const join = useCallback(
    async (channel: Channel) => {
      const cur = stateRef.current;
      if (cur.status !== "idle" && cur.channel.id === channel.id) return;
      await leave();
      const my = ++seq.current;
      // Já marca no ref: um segundo clique antes do re-render não dispara outro join
      stateRef.current = { status: "connecting", channel };
      setState(stateRef.current);
      try {
        const t0 = performance.now();
        const meeting = new Meeting(channel.id, name);
        await meeting.join({ audio: micWanted.current, muted: mutedRef.current, deafened: deafRef.current });
        if (my !== seq.current) {
          void meeting.leave();
          return;
        }
        console.info(`[voz] entrou em ${Math.round(performance.now() - t0)}ms`);
        playSound("selfJoin");
        setState({ status: "connected", channel, meeting });
        // Em desenvolvimento dá pra inspecionar a chamada pelo console: __meeting
        if (import.meta.env.DEV) (window as unknown as { __meeting: Meeting }).__meeting = meeting;
      } catch (err) {
        if (my !== seq.current) return;
        setState({ status: "idle" });
        toast.error("Não deu pra conectar na voz", { description: (err as Error).message });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, leave]
  );

  const meeting = state.status === "connected" ? state.meeting : null;

  // Mic real = não está mudo nem surdo
  useEffect(() => {
    if (!meeting) return;
    const want = !muted && !deafened;
    if (meeting.self.audioEnabled === want) return;
    (want ? meeting.self.enableAudio() : meeting.self.disableAudio()).catch(() =>
      toast.error("Permissão do microfone negada")
    );
  }, [meeting, muted, deafened]);

  // Mic mexido pelos controles da chamada: reflete no painel do usuário
  useEffect(() => {
    if (!meeting) return;
    const onAudio = () => {
      if (meeting.self.audioEnabled) {
        setMuted(false);
        setDeafened(false);
      } else if (!deafRef.current) setMuted(true);
    };
    meeting.self.on("audioUpdate", onAudio);
    return () => {
      meeting.self.off("audioUpdate", onAudio);
    };
  }, [meeting]);

  // Fechou a aba/app no meio da chamada
  useEffect(() => {
    if (!meeting) return;
    const bye = () => void meeting.leave().catch(() => {});
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [meeting]);

  const toggleMute = () => {
    if (deafened) {
      // Igual ao Discord: desmutar enquanto surdo tira o surdo também
      setDeafened(false);
      setMuted(false);
      playSound("undeafen");
    } else {
      playSound(muted ? "unmute" : "mute");
      setMuted(!muted);
    }
  };
  const toggleDeafen = () => {
    playSound(deafened ? "undeafen" : "deafen");
    setDeafened(!deafened);
  };

  return { state, meeting, join, leave, prefetch, muted, deafened, toggleMute, toggleDeafen };
}

export type Voice = ReturnType<typeof useVoice>;
