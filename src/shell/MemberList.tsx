import { Volume2 } from "lucide-react";
import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import type { VisibleStatus } from "@/chat/protocol";
import { useChannels, useMyStatus, usePresence } from "@/chat/store";
import { Avatar, nameColor, statusLabel } from "./Avatar";
import { UserPopover } from "./UserPopover";

type Live = Map<string, { speaking: boolean; sub?: string }>;

/**
 * Lista de membros (240px): quem está online, com status e o que está fazendo.
 * Se você está numa chamada, quem está falando nela ganha o anel verde.
 */
export function MemberList({ me, meeting, onOpenDm }: { me: string; meeting: Meeting | null; onOpenDm: (name: string) => void }) {
  return (
    <aside className="scrollbar-thin flex w-60 shrink-0 flex-col overflow-y-auto bg-sidebar px-2 pt-6 pb-4 max-lg:hidden">
      {meeting ? <WithCall me={me} meeting={meeting} onOpenDm={onOpenDm} /> : <Members me={me} onOpenDm={onOpenDm} />}
    </aside>
  );
}

function WithCall({ me, meeting, onOpenDm }: { me: string; meeting: Meeting; onOpenDm: (name: string) => void }) {
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
  return <Members me={me} live={live} onOpenDm={onOpenDm} />;
}

function Members({ me, live, onOpenDm }: { me: string; live?: Live; onOpenDm: (name: string) => void }) {
  const { statuses, voice } = usePresence();
  const myStatus = useMyStatus();
  const channels = useChannels();
  const statusOf = (n: string): VisibleStatus =>
    n === me ? (myStatus === "invisible" ? "offline" : myStatus) : (statuses[n] ?? (live?.has(n) ? "online" : "offline"));
  // Você sempre aparece (mesmo antes do READY); quem está na chamada também
  const names = [...new Set([me, ...Object.keys(statuses), ...(live?.keys() ?? [])])].sort((a, b) => a.localeCompare(b));
  const voiceOf = new Map(voice.map((v) => [v.name, v.channelId]));
  const row = (name: string) => {
    const inVoice = voiceOf.get(name);
    const vName = inVoice && (channels.find((c) => c.id === inVoice)?.name ?? inVoice.replace(/^voz-/, ""));
    return { name, status: statusOf(name), speaking: live?.get(name)?.speaking, sub: live?.get(name)?.sub, voice: vName };
  };
  const online = names.map(row).filter((r) => r.status !== "offline");
  const offline = names.map(row).filter((r) => r.status === "offline");

  return (
    <>
      <Group title="Online" rows={online} me={me} onOpenDm={onOpenDm} />
      {!!offline.length && <Group title="Offline" rows={offline} me={me} onOpenDm={onOpenDm} />}
    </>
  );
}

type Row = { name: string; status: VisibleStatus; speaking?: boolean; sub?: string; voice?: string };

function Group({ title, rows, me, onOpenDm }: { title: string; rows: Row[]; me: string; onOpenDm: (name: string) => void }) {
  return (
    <section className="mb-5">
      <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} — {rows.length}
      </h3>
      <ul className="flex flex-col gap-px">
        {rows.map((r) => (
          <li key={r.name}>
            <UserPopover name={r.name} me={me} onOpenDm={onOpenDm} side="left">
              <button
                type="button"
                className={`flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-white/5 ${r.status === "offline" ? "opacity-40 hover:opacity-100" : ""}`}
              >
                <Avatar name={r.name} size={32} status={r.status === "offline" ? null : r.status} speaking={r.speaking} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate font-medium" style={{ color: nameColor(r.name) }}>
                    {r.name}
                  </span>
                  {(r.sub || r.voice || r.status === "dnd" || r.status === "idle") && (
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {r.voice && !r.sub && <Volume2 className="size-3 shrink-0 text-success" />}
                      {r.sub ?? (r.voice ? `Na voz: ${r.voice}` : statusLabel[r.status])}
                    </span>
                  )}
                </span>
              </button>
            </UserPopover>
          </li>
        ))}
      </ul>
    </section>
  );
}
