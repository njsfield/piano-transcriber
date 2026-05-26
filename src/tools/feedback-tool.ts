// src/tools/feedback-tool.ts
import { BaseTool } from '../tool';
import type { MidiEvent, ChordEvent, MusicFeatures } from '../pipeline/types';
import type { ToolParameters } from '../types';

export interface NoteInfo {
  id: string;
  measure: number;
  beat: number;
  pitch: number;
  pitchName: string;
  durationBeats: number;
  isGraceNote: boolean;
  pitchClass: number;
}

export interface PhraseInfo {
  startMeasure: number;
  startBeat: number;
  endMeasure: number;
  endBeat: number;
  lengthBeats: number;
  notes: NoteInfo[];
}

export interface FeedbackToolOutput {
  tempo: number;
  beatsPerMeasure: number;
  totalMeasures: number;
  phrases: PhraseInfo[];
  chordChart: ChordEvent[];
  pitchRange: { lowestMidi: number; highestMidi: number; semitones: number };
  rhythmicUnitCounts: Record<string, number>;
}

const PITCH_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function pitchName(midi: number): string {
  return PITCH_NAMES[midi % 12]! + String(Math.floor(midi / 12) - 1);
}

function buildPhrase(notes: NoteInfo[], beatsPerMeasure: number): PhraseInfo {
  const first = notes[0]!;
  const last = notes[notes.length - 1]!;
  const startAbsBeat = (first.measure - 1) * beatsPerMeasure + first.beat;
  const endAbsBeat = (last.measure - 1) * beatsPerMeasure + last.beat + last.durationBeats;
  return {
    startMeasure: first.measure,
    startBeat: first.beat,
    endMeasure: last.measure,
    endBeat: Math.round((last.beat + last.durationBeats) * 100) / 100,
    lengthBeats: Math.round((endAbsBeat - startAbsBeat) * 100) / 100,
    notes,
  };
}

function countRhythmicUnits(notes: NoteInfo[]): Record<string, number> {
  const counts: Record<string, number> = {
    whole: 0, half: 0, quarter: 0, dottedQuarter: 0,
    eighth: 0, eighthTriplet: 0, sixteenth: 0, other: 0,
  };
  for (const n of notes) {
    if (n.isGraceNote) continue;
    const d = n.durationBeats;
    if (d >= 3.8) counts['whole']!++;
    else if (d >= 1.8) counts['half']!++;
    else if (d >= 1.4) counts['dottedQuarter']!++;
    else if (d >= 0.9) counts['quarter']!++;
    else if (d >= 0.62) counts['eighth']!++;
    else if (d >= 0.55) counts['eighthTriplet']!++;
    else if (d >= 0.4) counts['sixteenth']!++;
    else counts['other']!++;
  }
  return counts;
}

export class FeedbackTool extends BaseTool {
  constructor(
    private readonly rhNotes: MidiEvent[],
    private readonly chords: ChordEvent[],
    private readonly features: MusicFeatures,
  ) {
    super('get_feedback_data', 'Extract pre-processed musical data from the MIDI notes for analysis.');
  }

  get parameters(): ToolParameters {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  execute(_input: Record<string, unknown>): string {
    const tempo = this.features.temposBpm[0] ?? 120;
    const beatsPerMeasure = parseInt(this.features.timeSignature.split('/')[0] ?? '4', 10);
    const msPerBeat = 60000 / tempo;

    const notesSorted = [...this.rhNotes].sort((a, b) => a.startMs - b.startMs);

    const noteInfos: NoteInfo[] = notesSorted.map((n) => {
      const beatPos = n.startMs / msPerBeat;
      const measure = Math.floor(beatPos / beatsPerMeasure) + 1;
      const beat = (beatPos % beatsPerMeasure) + 1;
      const durationBeats = n.durationMs / msPerBeat;
      return {
        id: n.id,
        measure,
        beat: Math.round(beat * 100) / 100,
        pitch: n.pitch,
        pitchName: pitchName(n.pitch),
        durationBeats: Math.round(durationBeats * 1000) / 1000,
        isGraceNote: durationBeats < 0.083,
        pitchClass: n.pitch % 12,
      };
    });

    const REST_THRESHOLD_BEATS = 1;
    const phrases: PhraseInfo[] = [];
    let currentPhrase: NoteInfo[] = [];

    for (const note of noteInfos) {
      if (currentPhrase.length === 0) {
        currentPhrase.push(note);
        continue;
      }
      const prev = currentPhrase[currentPhrase.length - 1]!;
      const prevEndBeat = (prev.measure - 1) * beatsPerMeasure + prev.beat + prev.durationBeats;
      const currBeat = (note.measure - 1) * beatsPerMeasure + note.beat;
      const gap = currBeat - prevEndBeat;
      if (gap >= REST_THRESHOLD_BEATS) {
        phrases.push(buildPhrase(currentPhrase, beatsPerMeasure));
        currentPhrase = [note];
      } else {
        currentPhrase.push(note);
      }
    }
    if (currentPhrase.length > 0) phrases.push(buildPhrase(currentPhrase, beatsPerMeasure));

    const pitches = notesSorted.map(n => n.pitch);
    const lowestMidi = pitches.length > 0 ? Math.min(...pitches) : 0;
    const highestMidi = pitches.length > 0 ? Math.max(...pitches) : 0;
    const totalMeasures = noteInfos.length > 0 ? Math.max(...noteInfos.map(n => n.measure)) : 0;

    const output: FeedbackToolOutput = {
      tempo,
      beatsPerMeasure,
      totalMeasures,
      // rhNotes omitted — use phrases[].notes for per-note detail to keep prompt size down
      phrases,
      chordChart: this.chords,
      pitchRange: { lowestMidi, highestMidi, semitones: highestMidi - lowestMidi },
      rhythmicUnitCounts: countRhythmicUnits(noteInfos),
    };

    return JSON.stringify(output, null, 2);
  }
}
