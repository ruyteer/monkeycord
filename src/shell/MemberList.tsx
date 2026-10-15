import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import { usePresence } from "@/chat/store";
import { Avatar, nameColor } from "./Avatar";
import { findChannel } from "./data";

type Live = Map<string, { speaking: boolean; sub?: string }>;

/**
 * Lista de membros (240px): quem está online (presença do gateway). Se você
 * está numa chamada, quem está falando nela ganha o anel verde.
 */
export function MemberList({ me, meeting }: { me: string; meeting: Meeting | null }) {
  return (
    <aside className="scrollbar-thin flex w-60 shrink-0 flex-col overflow-y-auto bg-sidebar px-2 pt-6 pb-4 max-lg:hidden">
      {meeting ? <WithCall me={me} meeting={meeting} /> : <Members me={me} />}
    </aside>
  );
}

function WithCall({ me, meeting }: { me: string; meeting: Meeting }) {
  const { people, speaking } = useCall(meeting);
  const live: Live = new Map(
    people.map((p) => [
      p.name,
      {
        speaking: p.id === speaking && p.audioEnabled,
        sub: p.screenEnabled ? "Transmitindo a tela" : p.videoEnabled ? "Com a câmera ligada" : undefined,
      },
    ])
  );
  return <Members me={me} live={live} />;
}

function Members({ me, live }: { me: string; live?: Live }) {
  const { online, voice } = usePresence();
  // Você sempre aparece (mesmo antes do READY); quem está na chamada também
  const names = [...new Set([me, ...online, ...(live?.keys() ?? [])])].sort((a, b) => a.localeCompare(b));
  const voiceOf = new Map(voice.map((v) => [v.name, v.channelId]));
  return (
    <Group
      title="Online"
      names={names.map((name) => {
        const inVoice = voiceOf.get(name);
        return {
          name,
          speaking: live?.get(name)?.speaking,
          sub: live?.get(name)?.sub ?? (inVoice ? `Na voz: ${voiceName(inVoice)}` : undefined),
        };
      })}
    />
  );
}

function voiceName(channelId: string) {
  return findChannel(channelId)?.name ?? channelId.replace(/^voz-/, "");
}

function Group({ title, names }: { title: string; names: { name: string; speaking?: boolean; sub?: string }[] }) {
  return (
    <section>
      <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} — {names.length}
      </h3>
      <ul className="flex flex-col gap-px">
        {names.map((n) => (
          <li key={n.name} className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-white/5">
            <Avatar name={n.name} size={32} status="online" speaking={n.speaking} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-medium" style={{ color: nameColor(n.name) }}>
                {n.name}
              </span>
              {n.sub && <span className="block truncate text-xs text-muted-foreground">{n.sub}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
