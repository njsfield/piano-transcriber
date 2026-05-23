import type { MidiEvent, ChordEvent, HandSeparation } from '../pipeline/types';

const ROOT_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const QUALITY_INTERVALS: Record<string, number[]> = {
  '':      [0, 4, 7],
  'maj':   [0, 4, 7],
  'maj7':  [0, 4, 7, 11],
  'maj9':  [0, 4, 7, 11, 2],
  '6':     [0, 4, 7, 9],
  'maj6':  [0, 4, 7, 9],
  'm':     [0, 3, 7],
  'min':   [0, 3, 7],
  'm7':    [0, 3, 7, 10],
  'm9':    [0, 3, 7, 10, 2],
  'm6':    [0, 3, 7, 9],
  '7':     [0, 4, 7, 10],
  '9':     [0, 4, 7, 10, 2],
  '11':    [0, 4, 7, 10, 2, 5],
  '13':    [0, 4, 7, 10, 2, 5, 9],
  'dim':   [0, 3, 6],
  'dim7':  [0, 3, 6, 9],
  'm7b5':  [0, 3, 6, 10],
  'ø':     [0, 3, 6, 10],
  'aug':   [0, 4, 8],
  'sus4':  [0, 5, 7],
  'sus2':  [0, 2, 7],
};

const LH_PITCH_CEILING = 64; // E4 — practical ceiling for shell voicings

function chordTones(symbol: string): Set<number> {
  const m = symbol.match(/^([A-G])([b#]*)(.*)$/);
  if (!m) return new Set([0, 4, 7]);
  const [, step, acc, quality] = m;
  const accVal = [...acc].reduce((sum, c) => sum + (c === '#' ? 1 : -1), 0);
  const rootPc = ((ROOT_TO_PC[step] ?? 0) + accVal + 12) % 12;
  const strippedQuality = quality.replace(/\/[A-G][b#]*$/, '');
  const intervals = QUALITY_INTERVALS[strippedQuality] ?? [0, 4, 7];
  return new Set(intervals.map(i => (rootPc + i) % 12));
}

function activeChord(
  note: MidiEvent,
  sortedChords: ChordEvent[],
  msPerBeat: number,
  msPerMeasure: number,
): ChordEvent | null {
  const measure = Math.floor(note.startMs / msPerMeasure) + 1;
  const beat = Math.floor((note.startMs % msPerMeasure) / msPerBeat) + 1;
  let active: ChordEvent | null = null;
  for (const chord of sortedChords) {
    if (chord.measure < measure || (chord.measure === measure && chord.beat <= beat)) {
      active = chord;
    } else {
      break;
    }
  }
  return active;
}

export function classifyHands(
  notes: MidiEvent[],
  chords: ChordEvent[],
  tempo: number,
  beatsPerMeasure: number,
): HandSeparation {
  if (chords.length === 0) {
    return {
      leftHand: notes.filter(n => n.pitch < 60),
      rightHand: notes.filter(n => n.pitch >= 60),
    };
  }

  const sortedChords = [...chords].sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.beat - b.beat,
  );
  const msPerBeat = 60000 / tempo;
  const msPerMeasure = msPerBeat * beatsPerMeasure;

  const leftHand: MidiEvent[] = [];
  const rightHand: MidiEvent[] = [];

  for (const note of notes) {
    if (note.pitch <= LH_PITCH_CEILING) {
      const chord = activeChord(note, sortedChords, msPerBeat, msPerMeasure);
      if (chord && chordTones(chord.symbol).has(note.pitch % 12)) {
        leftHand.push(note);
        continue;
      }
    }
    rightHand.push(note);
  }

  return { leftHand, rightHand };
}
