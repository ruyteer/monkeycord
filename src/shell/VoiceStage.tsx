import { useState } from "react";
import { Check, Link2, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { CallView } from "@/call/CallView";
import type { Channel } from "./data";
import { ChannelHeader, HeaderIcon } from "./TextChannel";
import type { Voice } from "./useVoice";

/** Canal de voz aberto: a chamada ocupa a área do chat, num fundo preto. */
export function VoiceStage({ channel, voice, onMenu }: { channel: Channel; voice: Voice; onMenu: () => void }) {
  const here = voice.state.status !== "idle" && voice.state.channel.id === channel.id;
  const [copied, setCopied] = useState(false);

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
                {here ? "Conectando..." : "Ninguém te chamou, mas pode entrar mesmo assim."}
              </p>
            </div>
            <button
              type="button"
              disabled={here}
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
