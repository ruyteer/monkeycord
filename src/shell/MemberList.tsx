import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import { Avatar, nameColor } from "./Avatar";

/**
 * Lista de membros (240px). Sem backend de presença ainda: mostra você e
 * quem está com você no canal de voz.
 */
export function MemberList({ me, meeting }: { me: string; meeting: Meeting | null }) {
  return (
    <aside className="scrollbar-thin flex w-60 shrink-0 flex-col overflow-y-auto bg-sidebar px-2 pt-6 pb-4 max-lg:hidden">
      {meeting ? <LiveMembers meeting={meeting} /> : <Group title="Online" names={[{ name: me }]} />}
    </aside>
  );
}

function LiveMembers({ meeting }: { meeting: Meeting }) {
  const { people, speaking } = useCall(meeting);
  return (
    <Group
      title="Na voz"
      names={people.map((p) => ({
        name: p.name,
        speaking: p.id === speaking && p.audioEnabled,
        sub: p.screenEnabled ? "Transmitindo a tela" : p.videoEnabled ? "Com a câmera ligada" : undefined,
      }))}
    />
  );
}

function Group({ title, names }: { title: string; names: { name: string; speaking?: boolean; sub?: string }[] }) {
  return (
    <section>
      <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} — {names.length}
      </h3>
      <ul className="flex flex-col gap-px">
        {names.map((n, i) => (
          <li key={i} className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-white/5">
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
