import { describe, it, expect } from 'vitest';
import { FlagSuspiciousTool } from './flag-suspicious-tool';
import type { MidiEvent } from '../pipeline/types';

function note(id: string, startMs: number, durationMs: number): MidiEvent {
  return { id, pitch: 60, startMs, durationMs, velocity: 80 };
}

describe('FlagSuspiciousTool', () => {
  it('flags notes shorter than 50ms', () => {
    const notes = [note('short', 0, 30), note('ok', 500, 500)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues).toHaveLength(1);
    expect(issues[0].noteId).toBe('short');
    expect(issues[0].type).toBe('short_note');
  });

  it('assigns high severity for notes under 20ms', () => {
    const notes = [note('tiny', 0, 10)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues[0].severity).toBe('high');
  });

  it('assigns medium severity for notes 20–49ms', () => {
    const notes = [note('mid', 0, 40)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues[0].severity).toBe('medium');
  });

  it('flags rhythmic outliers with z-score > 2.5', () => {
    // 15 regular notes at 500ms then one huge gap
    const notes = Array.from({ length: 15 }, (_, i) => note(`n${i}`, i * 500, 400));
    notes.push(note('outlier', 15 * 500 + 4000, 400)); // 4000ms gap — outlier
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    const outliers = issues.filter((i: { type: string }) => i.type === 'rhythmic_outlier');
    expect(outliers.length).toBeGreaterThan(0);
  });

  it('returns empty array for clean notes', () => {
    const notes = Array.from({ length: 4 }, (_, i) => note(`n${i}`, i * 500, 400));
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues).toHaveLength(0);
  });
});
