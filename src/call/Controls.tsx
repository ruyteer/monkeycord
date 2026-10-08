import { useEffect, useState, type ReactElement } from "react";
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  PictureInPicture2,
  Video as VideoIcon,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Meeting } from "./meeting";
import type { Person } from "./useCall";

export const canShareScreen =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

type Props = {
  meeting: Meeting;
  me: Person;
  onLeave: () => void;
  onPip?: () => void;
  /** Dentro da janela PiP: botões menores e sem tooltip (o portal é da página principal) */
  compact?: boolean;
};

export function Controls({ meeting, me, onLeave, onPip, compact }: Props) {
  const self = meeting.self;
  const sharing = me.screenEnabled;

  // Som da transmissão: a faixa continua indo, só muda. Dá pra ligar e desligar
  // no meio do filme (útil quando o som do Discord está entrando junto).
  const somTrack = me.screenAudio;
  const [som, setSom] = useState(true);
  useEffect(() => {
    if (!somTrack) return;
    somTrack.enabled = true;
    setSom(true);
  }, [somTrack]);
  const toggleSom = () => {
    if (!somTrack) return;
    somTrack.enabled = !somTrack.enabled;
    setSom(somTrack.enabled);
    toast(somTrack.enabled ? "Som da transmissão ligado" : "Som da transmissão desligado");
  };

  const toggleMic = () => (me.audioEnabled ? self.disableAudio() : self.enableAudio()).catch(fail);
  const toggleCam = () => (me.videoEnabled ? self.disableVideo() : self.enableVideo()).catch(fail);
  const toggleShare = async () => {
    if (sharing) return self.disableScreenShare().catch(fail);
    toast("Vai passar filme?", {
      description: "Escolha a aba do vídeo e marque “Compartilhar áudio da guia” pro som ir junto.",
      duration: 6000,
    });
    await self.enableScreenShare().catch(fail);
  };

  const size = compact ? "size-10 rounded-full" : "size-12 rounded-full sm:size-13";
  const icon = compact ? "size-4.5" : "size-5";

  return (
    <div className={cn("flex items-center justify-center", compact ? "gap-2" : "gap-2.5 sm:gap-3")}>
      <Ctl tip={me.audioEnabled ? "Desligar microfone" : "Ligar microfone"} compact={compact}>
        <Button
          aria-label="Microfone"
          onClick={toggleMic}
          className={cn(size, me.audioEnabled ? on : off)}
        >
          {me.audioEnabled ? <Mic className={icon} /> : <MicOff className={icon} />}
        </Button>
      </Ctl>

      <Ctl tip={me.videoEnabled ? "Desligar câmera" : "Ligar câmera"} compact={compact}>
        <Button
          aria-label="Câmera"
          onClick={toggleCam}
          className={cn(size, me.videoEnabled ? on : off)}
        >
          {me.videoEnabled ? <VideoIcon className={icon} /> : <VideoOff className={icon} />}
        </Button>
      </Ctl>

      {canShareScreen && !compact && (
        <Ctl tip={sharing ? "Parar de apresentar" : "Compartilhar tela"}>
          <Button
            aria-label="Compartilhar tela"
            onClick={toggleShare}
            className={cn(size, sharing ? "bg-sky-400 text-black hover:bg-sky-300" : on)}
          >
            {sharing ? <MonitorX className={icon} /> : <MonitorUp className={icon} />}
          </Button>
        </Ctl>
      )}

      {sharing && somTrack && !compact && (
        <Ctl tip={som ? "Desligar o som da transmissão" : "Ligar o som da transmissão"}>
          <Button
            aria-label="Som da transmissão"
            onClick={toggleSom}
            className={cn(size, som ? on : off)}
          >
            {som ? <Volume2 className={icon} /> : <VolumeX className={icon} />}
          </Button>
        </Ctl>
      )}

      {onPip && !compact && (
        <Ctl tip="Janela flutuante">
          <Button aria-label="Janela flutuante" onClick={onPip} className={cn(size, on, "max-sm:hidden")}>
            <PictureInPicture2 className={icon} />
          </Button>
        </Ctl>
      )}

      <Ctl tip="Sair da chamada" compact={compact}>
        <Button
          aria-label="Sair"
          onClick={onLeave}
          className={cn(
            compact ? "h-10 w-14 rounded-full" : "h-12 w-16 rounded-full sm:h-13 sm:w-18",
            "bg-destructive text-white hover:bg-destructive/85"
          )}
        >
          <PhoneOff className={icon} />
        </Button>
      </Ctl>
    </div>
  );
}

const on = "border border-white/8 bg-white/8 text-foreground backdrop-blur-md hover:bg-white/14";
const off = "bg-destructive/90 text-white hover:bg-destructive";

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission|denied|NotAllowed/i.test(msg)) toast.error("Permissão negada pelo navegador");
  else if (!/abort|cancel/i.test(msg)) toast.error("Não rolou", { description: msg });
}

function Ctl({ tip, compact, children }: { tip: string; compact?: boolean; children: ReactElement }) {
  if (compact) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top" sideOffset={8}>
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
