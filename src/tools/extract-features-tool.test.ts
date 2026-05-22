import { describe, it, expect } from 'vitest';
import { ExtractFeaturesTool } from './extract-features-tool';
import type { MidiEvent } from '../pipeline/types';

function makeNote(id: string, pitch: number, startMs: number, durationMs: number): MidiEvent {
  return { id, pitch, startMs, durationMs, velocity: 80 };
}

describe('ExtractFeaturesTool', () => {
  it('returns 4/4 as time signature placeholder', async () => {
    const notes = [makeNote('a', 60, 0, 500), makeNote('b', 62, 500, 500)];
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.timeSignature).toBe('4/4');
  });

  it('estimates tempo from inter-onset intervals', async () => {
    // Quarter notes at 120 BPM = 500ms apart
    const notes = Array.from({ length: 8 }, (_, i) =>
      makeNote(`n${i}`, 60 + i, i * 500, 400),
    );
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.temposBpm[0]).toBeGreaterThan(100);
    expect(result.temposBpm[0]).toBeLessThan(140);
  });

  it('estimates key as a string containing "major" or "minor"', async () => {
    // C major chord
    const notes = [60, 64, 67, 72, 64, 67].map((pitch, i) =>
      makeNote(`n${i}`, pitch, i * 300, 250),
    );
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.key).toMatch(/major|minor/);
  });
});
