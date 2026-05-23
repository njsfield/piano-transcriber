import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Midi } from '@tonejs/midi';
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, HandSeparation, RendererResult } from '../pipeline/types';

// Read lazily so dotenv has time to load before this module's top-level runs.
function getMscore() { return process.env['MSCORE_PATH'] ?? 'mscore'; }

function handsToMidiBuffer(leftHand: MidiEvent[], rightHand: MidiEvent[]): Buffer {
  const midi = new Midi();

  // Track 0 = right hand (treble). Track 1 = left hand (bass).
  // MuseScore renders two-track piano MIDI as a grand staff with fixed clefs.
  const rh = midi.addTrack();
  for (const note of rightHand) {
    rh.addNote({
      midi: note.pitch,
      time: note.startMs / 1000,
      duration: note.durationMs / 1000,
      velocity: note.velocity / 127,
    });
  }

  const lh = midi.addTrack();
  for (const note of leftHand) {
    lh.addNote({
      midi: note.pitch,
      time: note.startMs / 1000,
      duration: note.durationMs / 1000,
      velocity: note.velocity / 127,
    });
  }

  return Buffer.from(midi.toArray());
}

function spawnAndWait(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' });
    const stderr: string[] = [];
    proc.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.join('')}`));
    });
    proc.on('error', err => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          `MuseScore not found at "${cmd}". Install it (brew install musescore) ` +
          `or set MSCORE_PATH to the correct binary path.`,
        ));
      } else {
        reject(err);
      }
    });
  });
}

export class RenderTool extends BaseTool {
  private hands: HandSeparation;
  private outputDir: string;

  constructor(hands: HandSeparation, outputDir: string) {
    super('render_midi', 'Convert MIDI events to MusicXML and PDF using MuseScore');
    this.hands = hands;
    this.outputDir = outputDir;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  async execute(_params: Record<string, unknown>): Promise<string> {
    const midiPath = join(this.outputDir, 'output.mid');
    const xmlPath = join(this.outputDir, 'output.musicxml');
    const pdfPath = join(this.outputDir, 'output.pdf');

    const mscore = getMscore();
    await writeFile(midiPath, handsToMidiBuffer(this.hands.leftHand, this.hands.rightHand));
    await spawnAndWait(mscore, ['-o', xmlPath, midiPath]);
    await spawnAndWait(mscore, ['-o', pdfPath, midiPath]);

    const result: RendererResult = { musicxmlPath: xmlPath, pdfPath };
    return JSON.stringify(result);
  }
}
