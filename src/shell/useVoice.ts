import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createMeeting, fetchToken, type Meeting } from "@/call/meeting";
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
  const micRef = useRef(!muted && !deafened);
  micRef.current = !muted && !deafened;
  // Cada join/leave ganha um número; respostas atrasadas de um join antigo são descartadas
  const seq = useRef(0);

  const leave = useCallback(async () => {
    const s = stateRef.current;
    seq.current++;
    stateRef.current = { status: "idle" };
    setState(stateRef.current);
    if (s.status === "connected") await s.meeting.leave().catch(() => {});
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
        const { authToken } = await fetchToken(name, channel.room ?? channel.id);
        const meeting = await createMeeting(authToken, { audio: micRef.current, video: false });
        if (my !== seq.current) return;
        await meeting.join();
        if (my !== seq.current) {
          meeting.leave().catch(() => {});
          return;
        }
        setState({ status: "connected", channel, meeting });
      } catch (err) {
        if (my !== seq.current) return;
        setState({ status: "idle" });
        toast.error("Não deu pra conectar na voz", { description: (err as Error).message });
      }
    },
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
    } else setMuted((m) => !m);
  };
  const toggleDeafen = () => setDeafened((d) => !d);

  return { state, meeting, join, leave, muted, deafened, toggleMute, toggleDeafen };
}

export type Voice = ReturnType<typeof useVoice>;
