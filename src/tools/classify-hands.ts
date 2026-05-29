import type { MidiEvent, ChordEvent, HandSeparation } from "../pipeline/types";

interface ClassifyHandsResponse {
  hand_assignment: Record<string, "LH" | "RH">;
  hand_confidences: Record<string, number>;
}

export async function classifyHands(
  midiEvents: MidiEvent[],
  chords: ChordEvent[],
  tempo: number,
  pythonServiceUrl: string,
) {
  const response = await fetch(`${pythonServiceUrl}/classify_hands`, {
    method: "POST",
    body: JSON.stringify({
      midiEvents,
      chords,
      tempo,
    }),
  });

  const { hand_assignment } = (await response.json()) as ClassifyHandsResponse;

  const leftHand: MidiEvent[] = [];
  const rightHand: MidiEvent[] = [];

  for (const midiEvent of midiEvents) {
    if (hand_assignment[midiEvent.id] === "LH") {
      leftHand.push(midiEvent);
    } else {
      rightHand.push(midiEvent);
    }
  }

  return { leftHand, rightHand };
}
