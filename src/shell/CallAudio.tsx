import { useEffect } from "react";
import { usePrefs, volumeFor } from "@/call/devices";
import type { Meeting } from "@/call/meeting";
import { playSound } from "@/call/sounds";
import { useCall } from "@/call/useCall";
import { Audio } from "@/call/Video";

/**
 * Som da chamada, montado no shell: continua tocando enquanto você lê os
 * canais de texto. Surdo = não toca nada. Cada pessoa tem o próprio volume
 * (clique direito no nome dela no canal de voz).
 */
export function CallAudio({ meeting, deafened }: { meeting: Meeting; deafened: boolean }) {
  const { others } = useCall(meeting);
  const prefs = usePrefs();

  useEffect(() => {
    const joined = meeting.participants.joined;
    const onJoin = () => playSound("join");
    const onLeft = () => playSound("leave");
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
          {p.audioEnabled && <Audio track={p.audioTrack} volume={volumeFor(p.name)} sinkId={prefs.speakerId} />}
          {p.screenEnabled && p.screenAudio && (
            <Audio track={p.screenAudio} volume={volumeFor(`${p.name} (tela)`)} sinkId={prefs.speakerId} />
          )}
        </span>
      ))}
    </>
  );
}
