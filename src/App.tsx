import { useState } from "react";
import { ArrowRight, Loader2, Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CallView } from "./call/CallView";
import { createMeeting, fetchToken, type Meeting } from "./call/meeting";
import { initials } from "./call/Tile";
import { useCall } from "./call/useCall";
import { Video } from "./call/Video";

type Stage =
  | { step: "lobby" }
  | { step: "prejoin"; meeting: Meeting; room: string }
  | { step: "call"; meeting: Meeting; room: string }
  | { step: "left"; room: string };

export default function App() {
  const [stage, setStage] = useState<Stage>({ step: "lobby" });

  if (stage.step === "call")
    return (
      <CallView
        meeting={stage.meeting}
        room={stage.room}
        onLeave={() => setStage({ step: "left", room: stage.room })}
      />
    );

  return (
    <div className="lobby-glow flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-8">
      {stage.step === "lobby" && (
        <Lobby onReady={(meeting, room) => setStage({ step: "prejoin", meeting, room })} />
      )}
      {stage.step === "prejoin" && (
        <PreJoin
          meeting={stage.meeting}
          room={stage.room}
          onJoined={() => setStage({ ...stage, step: "call" })}
        />
      )}
      {stage.step === "left" && (
        <div className="hero-in flex flex-col items-center gap-5 text-center">
          <h1 className="chrome-title text-5xl">Falou!</h1>
          <p className="text-muted-foreground">Você saiu de #{stage.room}.</p>
          <Button variant="liquid-metal" size="xl" onClick={() => setStage({ step: "lobby" })}>
            Voltar pro MonkeyCord
          </Button>
        </div>
      )}
    </div>
  );
}

function Lobby({ onReady }: { onReady: (m: Meeting, room: string) => void }) {
  const [name, setName] = useState(() => safeGet("nome"));
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get("sala") ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      safeSet("nome", name.trim());
      const { authToken, room: r } = await fetchToken(name.trim(), room);
      history.replaceState(null, "", "?sala=" + encodeURIComponent(r));
      onReady(await createMeeting(authToken), r);
    } catch (err) {
      toast.error("Não deu pra entrar", { description: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h1 className="chrome-title hero-in text-7xl sm:text-8xl">MonkeyCord</h1>
      <p className="hero-in mt-2 mb-8 text-center text-balance text-muted-foreground" style={{ "--d": "0.1s" } as React.CSSProperties}>
        Chamada de vídeo com a galera. Só colocar o nome.
      </p>

      <form
        onSubmit={submit}
        className="hero-in flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 backdrop-blur-sm sm:p-5"
        style={{ "--d": "0.2s" } as React.CSSProperties}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Seu nome</span>
          <Input
            inputSize="lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como a galera te chama"
            maxLength={40}
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Sala</span>
          <Input
            inputSize="lg"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="geral"
            maxLength={40}
          />
        </label>
        <Button type="submit" variant="liquid-metal" size="cta" disabled={busy || !name.trim()} className="mt-2 w-full">
          {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          {busy ? "Preparando..." : "Continuar"}
        </Button>
      </form>
      <p className="hero-in mt-4 text-center text-xs text-muted-foreground/70" style={{ "--d": "0.3s" } as React.CSSProperties}>
        Quem colocar a mesma sala cai na mesma chamada.
      </p>
    </div>
  );
}

/** Prévia da câmera/mic antes de entrar (igual o Meet). */
function PreJoin({ meeting, room, onJoined }: { meeting: Meeting; room: string; onJoined: () => void }) {
  const { me } = useCall(meeting);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      await meeting.join();
      onJoined();
    } catch (err) {
      toast.error("Falhou ao entrar", { description: (err as Error).message });
      setBusy(false);
    }
  };

  const toggle = (on: boolean, enable: () => Promise<void>, disable: () => Promise<void>) =>
    (on ? disable() : enable()).catch(() => toast.error("Permissão negada pelo navegador"));

  return (
    <div className="hero-in flex w-full max-w-md flex-col items-center gap-5">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Entrando em</p>
        <h2 className="chrome-title text-4xl">#{room}</h2>
      </div>

      <div className="relative aspect-3/4 w-full max-w-72 overflow-hidden rounded-2xl border bg-[#111113] sm:aspect-video sm:max-w-none">
        {me.videoEnabled ? (
          <Video track={me.videoTrack} mirror />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3">
            <div className="flex size-20 items-center justify-center rounded-full border border-white/10 bg-white/6 text-2xl font-medium">
              {initials(me.name)}
            </div>
            <span className="text-sm text-muted-foreground">Câmera desligada</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
          <Button
            aria-label="Microfone"
            onClick={() => toggle(me.audioEnabled, () => meeting.self.enableAudio(), () => meeting.self.disableAudio())}
            className={cn("size-12 rounded-full", me.audioEnabled ? "border border-white/10 bg-black/50 text-white backdrop-blur-md hover:bg-black/70" : "bg-destructive text-white hover:bg-destructive/85")}
          >
            {me.audioEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </Button>
          <Button
            aria-label="Câmera"
            onClick={() => toggle(me.videoEnabled, () => meeting.self.enableVideo(), () => meeting.self.disableVideo())}
            className={cn("size-12 rounded-full", me.videoEnabled ? "border border-white/10 bg-black/50 text-white backdrop-blur-md hover:bg-black/70" : "bg-destructive text-white hover:bg-destructive/85")}
          >
            {me.videoEnabled ? <VideoIcon className="size-5" /> : <VideoOff className="size-5" />}
          </Button>
        </div>
      </div>

      <Button variant="liquid-metal" size="cta" onClick={join} disabled={busy} className="w-full max-w-72 sm:max-w-xs">
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy ? "Entrando..." : `Entrar como ${me.name}`}
      </Button>
    </div>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* modo privado */
  }
}
