import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CallAudio } from "./CallAudio";
import { ChannelSidebar } from "./ChannelSidebar";
import { allChannels, findChannel, voiceChannelForRoom, type Channel } from "./data";
import { MemberList } from "./MemberList";
import { ServerRail } from "./ServerRail";
import { TextChannel } from "./TextChannel";
import { useVoice } from "./useVoice";
import { VoiceStage } from "./VoiceStage";

type Props = {
  name: string;
  /** Veio por link de convite (?sala=): já entra na voz dessa sala */
  inviteRoom?: string;
  onLogout: () => void;
};

/**
 * Layout estilo Discord:
 * servidores (72) | canais (240) | chat ou chamada | membros (240)
 * No celular, servidores + canais viram uma gaveta.
 */
export function Shell({ name, inviteRoom, onLogout }: Props) {
  const voice = useVoice(name);
  const [extraVoice] = useState(() => (inviteRoom ? voiceChannelForRoom(inviteRoom) : null));
  const [selectedId, setSelectedId] = useState(() => extraVoice?.id ?? safeGet("mc:canal") ?? allChannels[0].id);
  const [drawer, setDrawer] = useState(false);
  const [showMembers, setShowMembers] = useState(true);

  const selected = findChannel(selectedId) ?? (extraVoice?.id === selectedId ? extraVoice : allChannels[0]);

  // Link de convite: entra direto
  useEffect(() => {
    if (extraVoice) void voice.join(extraVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (c: Channel) => {
    setSelectedId(c.id);
    setDrawer(false);
    if (findChannel(c.id)) safeSet("mc:canal", c.id);
    if (c.kind === "voice") {
      void voice.join(c);
      history.replaceState(null, "", "?sala=" + encodeURIComponent(c.room ?? c.id));
    } else history.replaceState(null, "", location.pathname);
  };

  const logout = async () => {
    await voice.leave();
    onLogout();
  };

  return (
    <div className="flex h-full overflow-hidden bg-rail">
      {/* Fundo escuro da gaveta no celular */}
      <div
        onClick={() => setDrawer(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 transition-opacity md:hidden",
          drawer ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        className={cn(
          "safe-top flex shrink-0 bg-rail transition-transform duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40",
          !drawer && "max-md:-translate-x-full"
        )}
      >
        <ServerRail />
        <ChannelSidebar
          me={name}
          selected={selected.id}
          extraVoice={extraVoice}
          voice={voice}
          onSelect={select}
          onLogout={logout}
        />
      </div>

      <main className="safe-top flex min-w-0 flex-1 bg-main">
        {selected.kind === "voice" ? (
          <VoiceStage channel={selected} voice={voice} onMenu={() => setDrawer(true)} />
        ) : (
          <>
            <TextChannel
              channel={selected}
              me={name}
              showMembers={showMembers}
              onToggleMembers={() => setShowMembers((s) => !s)}
              onMenu={() => setDrawer(true)}
            />
            {showMembers && <MemberList me={name} meeting={voice.meeting} />}
          </>
        )}
      </main>

      {voice.meeting && <CallAudio meeting={voice.meeting} deafened={voice.deafened} />}
    </div>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* modo privado */
  }
}
