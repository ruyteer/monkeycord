import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Props = {
  track?: MediaStreamTrack;
  mirror?: boolean;
  fit?: "cover" | "contain";
  className?: string;
  /** Safari/iOS: entra em PiP sozinho quando o app vai pro fundo */
  autoPip?: boolean;
  /** Vídeo principal: é o que vai pro PiP quando não há Document PiP */
  main?: boolean;
};

export function Video({ track, mirror, fit = "cover", className, autoPip, main }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => {});
  }, [track]);

  return (
    <video
      ref={ref}
      data-main={main || undefined}
      autoPlay
      playsInline
      muted
      {...(autoPip ? { autopictureinpicture: "" } : {})}
      className={cn(
        "size-full bg-black",
        fit === "cover" ? "object-cover" : "object-contain",
        mirror && "-scale-x-100",
        className
      )}
    />
  );
}

/**
 * Toca o áudio de um participante (microfone ou áudio do compartilhamento).
 * volume de 0 a 1 (o <audio> não passa disso); sinkId = fone/caixa escolhido nas configurações.
 */
export function Audio({ track, volume = 1, sinkId }: { track?: MediaStreamTrack; volume?: number; sinkId?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => {});
  }, [track]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId) el.setSinkId(sinkId === "default" ? "" : sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}
