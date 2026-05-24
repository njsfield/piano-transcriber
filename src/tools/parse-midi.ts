import { Midi } from '@tonejs/midi';
import { readFile } from 'fs/promises';
import type { TranscriptionResult, MidiEvent } from '../pipeline/types';

export async function parseMidi(midiPath: string): Promise<TranscriptionResult> {
  const buf = await readFile(midiPath);
  const midi = new Midi(buf);
  const notes: MidiEvent[] = [];
  let idCounter = 0;
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      notes.push({
        id: String(idCounter++),
        pitch: note.midi,
        startMs: Math.round(note.time * 1000),
        durationMs: Math.round(note.duration * 1000),
        velocity: Math.round(note.velocity * 127),
      });
    }
  }
  notes.sort((a, b) => a.startMs - b.startMs);
  return { midi: notes, confidences: [] };
}
