import { useState } from "react";
import { Check, Link2, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { CallView } from "@/call/CallView";
import { usePresence } from "@/chat/store";
import { Avatar } from "./Avatar";
import type { Channel } from "./data";
import { ChannelHeader, HeaderIcon } from "./TextChannel";
import type { Voice } from "./useVoice";

/** Canal de voz aberto: a chamada ocupa a área do chat, num fundo preto. */
export function VoiceStage({ channel, voice, onMenu }: { channel: Channel; voice: Voice; onMenu: () => void }) {
  const here = voice.state.status !== "idle" && voice.state.channel.id === channel.id;
  const [copied, setCopied] = useState(false);
  const { voice: states } = usePresence();
  // Quem está lá dentro (a mesma pessoa em duas abas conta uma vez)
  const inside = [...new Set(states.filter((v) => v.channelId === channel.id).map((v) => v.name))];

  const invite = async () => {
    const url = `${location.origin}/?sala=${encodeURIComponent(channel.room ?? channel.id)}`;
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ title: "MonkeyCord", text: "Cola na call", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado, manda pra galera");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* cancelado */
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-black">
      <ChannelHeader
        icon={<Volume2 className="size-6" />}
        title={channel.name}
        onMenu={onMenu}
        actions={
          <HeaderIcon label="Convidar" onClick={invite}>
            {copied ? <Check className="size-5" /> : <Link2 className="size-5" />}
          </HeaderIcon>
        }
      />

      <div className="min-h-0 flex-1">
        {here && voice.state.status === "connected" ? (
          <CallView meeting={voice.state.meeting} room={channel.name} onLeave={() => void voice.leave()} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-white/6">
              <Volume2 className="size-10 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">{channel.name}</h2>
              <p className="mt-1 text-muted-foreground">
                {here
                  ? "Conectando..."
                  : inside.length
                    ? `${listNames(inside)} ${inside.length === 1 ? "está" : "estão"} na voz agora.`
                    : "Ninguém por aqui ainda. Entra e chama a galera."}
              </p>
            </div>
            {!here && !!inside.length && (
              <div className="flex -space-x-2">
                {inside.slice(0, 8).map((n) => (
                  <Avatar key={n} name={n} size={40} className="rounded-full ring-4 ring-black" />
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={here}
              onPointerEnter={() => voice.prefetch(channel)}
              onClick={() => void voice.join(channel)}
              className="flex h-10 items-center gap-2 rounded-full bg-success px-6 font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {here && <Loader2 className="size-4 animate-spin" />}
              Entrar na voz
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function listNames(names: string[]) {
  if (names.length <= 3) return names.join(", ").replace(/, ([^,]*)$/, " e $1");
  return `${names.slice(0, 2).join(", ")} e mais ${names.length - 2}`;
}
