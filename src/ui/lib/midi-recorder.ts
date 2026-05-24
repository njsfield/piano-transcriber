// src/ui/lib/midi-recorder.ts
import { Midi } from '@tonejs/midi';

interface NoteOn {
  pitch: number;
  velocity: number;
  startMs: number;
}

export interface MidiRecorder {
  start(): Promise<void>;
  stop(): Blob;
  getActiveNotes(): string[];
  deviceName: string | null;
}

const PITCH_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function pitchName(midi: number): string {
  return PITCH_NAMES[midi % 12]! + String(Math.floor(midi / 12) - 1);
}

export function createMidiRecorder(): MidiRecorder {
  let access: MIDIAccess | null = null;
  let startTime = 0;
  const activeNotes = new Map<number, NoteOn>(); // pitch → NoteOn
  const completedNotes: Array<{ pitch: number; velocity: number; startMs: number; durationMs: number }> = [];
  let boundHandler: ((e: Event) => void) | null = null;
  let currentPort: MIDIInput | null = null;
  let _deviceName: string | null = null;

  const handleMessage = (e: Event) => {
    const msg = e as MIDIMessageEvent;
    const [status, pitch, velocity] = msg.data ?? [];
    if (pitch === undefined || velocity === undefined) return;
    const nowMs = Date.now() - startTime;

    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0;
    const isNoteOff = (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0);

    if (isNoteOn) {
      activeNotes.set(pitch, { pitch, velocity, startMs: nowMs });
    } else if (isNoteOff) {
      const on = activeNotes.get(pitch);
      if (on) {
        completedNotes.push({ ...on, durationMs: nowMs - on.startMs });
        activeNotes.delete(pitch);
      }
    }
  };

  return {
    get deviceName() { return _deviceName; },

    async start() {
      activeNotes.clear();
      completedNotes.length = 0;
      startTime = Date.now();

      if (!access) {
        access = await navigator.requestMIDIAccess();
      }

      const inputs = [...access.inputs.values()];
      const port = inputs[0];
      if (!port) throw new Error('No MIDI device found');

      _deviceName = port.name ?? null;
      currentPort = port;
      boundHandler = handleMessage;
      port.addEventListener('midimessage', boundHandler);
    },

    stop(): Blob {
      if (currentPort && boundHandler) {
        currentPort.removeEventListener('midimessage', boundHandler);
      }

      const endMs = Date.now() - startTime;
      for (const [, on] of activeNotes) {
        completedNotes.push({ ...on, durationMs: endMs - on.startMs });
      }
      activeNotes.clear();

      const midi = new Midi();
      const track = midi.addTrack();
      for (const note of completedNotes) {
        track.addNote({
          midi: note.pitch,
          time: note.startMs / 1000,
          duration: note.durationMs / 1000,
          velocity: note.velocity / 127,
        });
      }

      const bytes = new Uint8Array(midi.toArray());
      return new Blob([bytes], { type: 'audio/midi' });
    },

    getActiveNotes(): string[] {
      return [...activeNotes.values()].map(n => pitchName(n.pitch));
    },
  };
}
