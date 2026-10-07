import { useEffect, useReducer, useRef, useState } from "react";
import type { Meeting } from "./meeting";

export type Person = {
  id: string;
  name: string;
  isSelf: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  screenEnabled: boolean;
  screenVideo?: MediaStreamTrack;
  screenAudio?: MediaStreamTrack;
};

type AnyParticipant = {
  id: string;
  name: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  screenShareEnabled: boolean;
  screenShareTracks?: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
};

function toPerson(p: AnyParticipant, isSelf: boolean): Person {
  return {
    id: p.id,
    name: p.name || "Sem nome",
    isSelf,
    videoEnabled: !!p.videoEnabled && !!p.videoTrack,
    audioEnabled: !!p.audioEnabled,
    videoTrack: p.videoTrack,
    audioTrack: p.audioTrack,
    screenEnabled: !!p.screenShareEnabled && !!p.screenShareTracks?.video,
    screenVideo: p.screenShareTracks?.video,
    screenAudio: p.screenShareTracks?.audio,
  };
}

/** Assina os eventos do RealtimeKit e devolve um retrato simples da chamada. */
export function useCall(meeting: Meeting) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const speakTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const { self, participants } = meeting;
    const joined = participants.joined;
    const selfEvents = ["videoUpdate", "audioUpdate", "screenShareUpdate", "roomJoined"] as const;
    const joinedEvents = [
      "participantJoined",
      "participantLeft",
      "videoUpdate",
      "audioUpdate",
      "screenShareUpdate",
    ] as const;

    selfEvents.forEach((e) => self.on(e, bump));
    joinedEvents.forEach((e) => joined.on(e, bump));

    const onSpeaker = ({ peerId, volume }: { peerId: string; volume: number }) => {
      if (volume < 5) return;
      setSpeaking(peerId);
      window.clearTimeout(speakTimer.current);
      speakTimer.current = window.setTimeout(() => setSpeaking(null), 1500);
    };
    participants.on("activeSpeaker", onSpeaker);

    return () => {
      selfEvents.forEach((e) => self.off(e, bump));
      joinedEvents.forEach((e) => joined.off(e, bump));
      participants.off("activeSpeaker", onSpeaker);
      window.clearTimeout(speakTimer.current);
    };
  }, [meeting]);

  const me = toPerson(meeting.self as unknown as AnyParticipant, true);
  me.id = meeting.self.id;
  const others = meeting.participants.joined
    .toArray()
    .map((p) => toPerson(p as unknown as AnyParticipant, false));
  const people = [me, ...others];
  const presenter = people.find((p) => p.screenEnabled) ?? null;

  return { me, others, people, presenter, speaking };
}
