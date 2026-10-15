import { useState, type ReactElement } from "react";
import { MessageCircle, Volume2 } from "lucide-react";
import { useChannels, usePresence } from "@/chat/store";
import { Avatar, nameHue, statusLabel } from "./Avatar";
import { Popover } from "./ui";

/** Cartão de perfil ao clicar num nome ou avatar, com atalho pra conversa direta. */
export function UserPopover({
  name,
  me,
  onOpenDm,
  side = "right",
  children,
}: {
  name: string;
  me: string;
  onOpenDm: (name: string) => void;
  side?: "right" | "left" | "top" | "bottom";
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} side={side} align="start" className="w-[300px] overflow-hidden">
      {open && (
        <Card
          name={name}
          me={me}
          onOpenDm={(n) => {
            setOpen(false);
            onOpenDm(n);
          }}
        />
      )}
    </Popover>
  );
}

function Card({ name, me, onOpenDm }: { name: string; me: string; onOpenDm: (name: string) => void }) {
  const { statuses, voice } = usePresence();
  const channels = useChannels();
  const status = statuses[name] ?? "offline";
  const inVoice = voice.find((v) => v.name === name);
  const voiceName = inVoice && (channels.find((c) => c.id === inVoice.channelId)?.name ?? inVoice.channelId);

  return (
    <div>
      <div className="h-[60px]" style={{ background: `linear-gradient(135deg, hsl(${nameHue(name)} 30% 22%), hsl(${(nameHue(name) + 40) % 360} 25% 14%))` }} />
      <div className="-mt-10 px-4">
        <Avatar name={name} size={80} status={status} ring="var(--popover)" className="rounded-full ring-[6px] ring-popover" />
      </div>
      <div className="px-4 pt-2 pb-4">
        <h3 className="text-xl font-bold">{name}</h3>
        <p className="text-sm text-muted-foreground">
          {statusLabel[status]}
          {name === me && " (você)"}
        </p>
        {voiceName && (
          <p className="mt-3 flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5 text-sm">
            <Volume2 className="size-4 text-success" />
            Na voz em <b className="truncate">{voiceName}</b>
          </p>
        )}
        {name !== me && (
          <button
            type="button"
            onClick={() => onOpenDm(name)}
            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-semibold text-background hover:bg-foreground/85"
          >
            <MessageCircle className="size-4" />
            Enviar mensagem
          </button>
        )}
      </div>
    </div>
  );
}
