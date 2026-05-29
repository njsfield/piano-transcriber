import { describe, it, expect, vi } from "vitest";
import { classifyHands } from "./classify-hands";
import type { MidiEvent, ChordEvent } from "../pipeline/types";

describe("classifyHands", () => {
  it("separates left and right hands from hand_seperation response", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            hand_assignment: {
              "1": "LH",
              "2": "RH",
            },
            hand_confidences: {},
          }),
      } as Response),
    );

    const midiEvents: MidiEvent[] = [
      {
        id: "1",
        pitch: 0,
        startMs: 0,
        durationMs: 50,
        velocity: 1,
      },
      {
        id: "2",
        pitch: 100,
        startMs: 0,
        durationMs: 50,
        velocity: 1,
      },
    ];
    const chords: ChordEvent[] = [];
    const tempo = 120;

    const result = await classifyHands(midiEvents, chords, tempo, "TEST_URL");

    expect(result).toHaveProperty("leftHand");
    expect(result).toHaveProperty("rightHand");

    expect(result.leftHand).toEqual([
      {
        id: "1",
        pitch: 0,
        startMs: 0,
        durationMs: 50,
        velocity: 1,
      },
    ]);

    expect(result.rightHand).toEqual([
      {
        id: "2",
        pitch: 100,
        startMs: 0,
        durationMs: 50,
        velocity: 1,
      },
    ]);
  });
});
