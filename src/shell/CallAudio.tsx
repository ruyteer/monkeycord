import { useEffect } from "react";
import { toast } from "sonner";
import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import { Audio } from "@/call/Video";

/**
 * Som da chamada, montado no shell: continua tocando enquanto você lê os
 * canais de texto. Surdo = não toca nada.
 */
export function CallAudio({ meeting, deafened }: { meeting: Meeting; deafened: boolean }) {
  const { others } = useCall(meeting);

  useEffect(() => {
    const joined = meeting.participants.joined;
    const onJoin = (p: { name: string }) => toast(`${p.name} entrou na voz`);
    const onLeft = (p: { name: string }) => toast(`${p.name} saiu da voz`);
    joined.on("participantJoined", onJoin);
    joined.on("participantLeft", onLeft);
    return () => {
      joined.off("participantJoined", onJoin);
      joined.off("participantLeft", onLeft);
    };
  }, [meeting]);

  if (deafened) return null;
  return (
    <>
      {others.map((p) => (
        <span key={p.id} hidden>
          {p.audioEnabled && <Audio track={p.audioTrack} />}
          {p.screenEnabled && p.screenAudio && <Audio track={p.screenAudio} />}
        </span>
      ))}
    </>
  );
}
