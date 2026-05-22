import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, MusicFeatures } from '../pipeline/types';

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function rotate(arr: number[], n: number): number[] {
  return [...arr.slice(n), ...arr.slice(0, n)];
}

function pearson(a: number[], b: number[]): number {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

function estimateTempo(notes: MidiEvent[]): number {
  if (notes.length < 2) return 120;
  const onsets = notes.map(n => n.startMs).sort((a, b) => a - b);
  const iois = onsets.slice(1)
    .map((t, i) => t - onsets[i])
    .filter(ioi => ioi > 50);
  if (!iois.length) return 120;
  iois.sort((a, b) => a - b);
  const median = iois[Math.floor(iois.length / 2)]!;
  return Math.round(60000 / median);
}

function estimateKey(notes: MidiEvent[]): string {
  const histogram = new Array(12).fill(0) as number[];
  for (const note of notes) histogram[note.pitch % 12] += note.durationMs;
  const total = histogram.reduce((s, v) => s + v, 0);
  if (total === 0) return 'C major';
  const norm = histogram.map(v => v / total);

  let bestKey = 'C major';
  let bestCorr = -Infinity;
  for (let root = 0; root < 12; root++) {
    const maj = pearson(norm, rotate(KS_MAJOR, root));
    if (maj > bestCorr) { bestCorr = maj; bestKey = `${NOTE_NAMES[root]} major`; }
    const min = pearson(norm, rotate(KS_MINOR, root));
    if (min > bestCorr) { bestCorr = min; bestKey = `${NOTE_NAMES[root]} minor`; }
  }
  return bestKey;
}

export class ExtractFeaturesTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('extract_features', 'Extract tempo, key, and time signature from the MIDI note events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  execute(_params: Record<string, unknown>): string {
    const features: MusicFeatures = {
      temposBpm: [estimateTempo(this.notes)],
      key: estimateKey(this.notes),
      timeSignature: '4/4',
    };
    return JSON.stringify(features);
  }
}
