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

/** Toca o áudio de um participante (microfone ou áudio do compartilhamento). */
export function Audio({ track }: { track?: MediaStreamTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => {});
  }, [track]);
  return <audio ref={ref} autoPlay />;
}
