import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, Issue } from '../pipeline/types';

function flagShortNotes(notes: MidiEvent[]): Issue[] {
  return notes
    .filter(n => n.durationMs < 50)
    .map(n => ({
      noteId: n.id,
      type: 'short_note' as const,
      description: `Note duration ${Math.round(n.durationMs)}ms is below 50ms threshold`,
      severity: n.durationMs < 20 ? ('high' as const) : ('medium' as const),
    }));
}

function flagRhythmicOutliers(notes: MidiEvent[]): Issue[] {
  if (notes.length < 3) return [];
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs);

  // Calculate inter-onset intervals
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ioi = sorted[i]!.startMs - sorted[i - 1]!.startMs;
    if (ioi > 50) {
      iois.push(ioi);
    }
  }

  if (iois.length < 2) return [];

  const mean = iois.reduce((s, v) => s + v, 0) / iois.length;
  const std = Math.sqrt(iois.reduce((s, v) => s + (v - mean) ** 2, 0) / iois.length);
  if (std === 0) return [];

  const issues: Issue[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ioi = sorted[i]!.startMs - sorted[i - 1]!.startMs;
    if (ioi <= 50) continue;
    const z = Math.abs(ioi - mean) / std;
    if (z > 2.5) {
      issues.push({
        noteId: sorted[i]!.id,
        type: 'rhythmic_outlier',
        description: `Onset gap of ${Math.round(ioi)}ms is ${z.toFixed(1)} std devs from median`,
        severity: z > 4 ? 'high' : 'medium',
      });
    }
  }
  return issues;
}

export class FlagSuspiciousTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('flag_suspicious', 'Flag short notes and rhythmic outliers in the MIDI events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  execute(_params: Record<string, unknown>): string {
    return JSON.stringify([
      ...flagShortNotes(this.notes),
      ...flagRhythmicOutliers(this.notes),
    ]);
  }
}
