import { describe, it, expect } from 'vitest';
import { ApplyOperationsTool } from './apply-operations-tool';
import type { MidiEvent, EditOperation } from '../pipeline/types';

const baseNotes: MidiEvent[] = [
  { id: 'n1', pitch: 60, startMs: 0, durationMs: 500, velocity: 80 },
  { id: 'n2', pitch: 62, startMs: 500, durationMs: 500, velocity: 80 },
  { id: 'n3', pitch: 64, startMs: 1000, durationMs: 500, velocity: 80 },
];

describe('ApplyOperationsTool', () => {
  it('deletes notes with type "delete"', () => {
    const ops: EditOperation[] = [{ type: 'delete', noteId: 'n2' }];
    const tool = new ApplyOperationsTool(baseNotes);
    const parsed = JSON.parse(tool.execute({ operations: ops }) as string);
    const result: MidiEvent[] = parsed.midi;
    expect(result.map(n => n.id)).toEqual(['n1', 'n3']);
  });

  it('respells a note pitch', () => {
    const ops: EditOperation[] = [{ type: 'respell', noteId: 'n1', newPitch: 61 }];
    const tool = new ApplyOperationsTool(baseNotes);
    const parsed = JSON.parse(tool.execute({ operations: ops }) as string);
    const result: MidiEvent[] = parsed.midi;
    expect(result.find(n => n.id === 'n1')!.pitch).toBe(61);
  });

  it('requantizes a note duration', () => {
    const ops: EditOperation[] = [{ type: 'requantize', noteId: 'n3', newDurationMs: 250 }];
    const tool = new ApplyOperationsTool(baseNotes);
    const parsed = JSON.parse(tool.execute({ operations: ops }) as string);
    const result: MidiEvent[] = parsed.midi;
    expect(result.find(n => n.id === 'n3')!.durationMs).toBe(250);
  });

  it('keeps notes with type "keep" unchanged', () => {
    const ops: EditOperation[] = [{ type: 'keep', noteId: 'n2' }];
    const tool = new ApplyOperationsTool(baseNotes);
    const parsed = JSON.parse(tool.execute({ operations: ops }) as string);
    const result: MidiEvent[] = parsed.midi;
    expect(result).toHaveLength(3);
    expect(result.find(n => n.id === 'n2')!.pitch).toBe(62);
  });

  it('passes through notes with no operation', () => {
    const tool = new ApplyOperationsTool(baseNotes);
    const parsed = JSON.parse(tool.execute({ operations: [] }) as string);
    const result: MidiEvent[] = parsed.midi;
    expect(result).toHaveLength(3);
  });
});
