import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Midi } from '@tonejs/midi';
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, RendererResult } from '../pipeline/types';

// Read lazily so dotenv has time to load before this module's top-level runs.
function getMscore() { return process.env['MSCORE_PATH'] ?? 'mscore'; }

function notesToMidiBuffer(notes: MidiEvent[]): Buffer {
  const midi = new Midi();
  const track = midi.addTrack();
  for (const note of notes) {
    track.addNote({
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
  private notes: MidiEvent[];
  private outputDir: string;

  constructor(notes: MidiEvent[], outputDir: string) {
    super('render_midi', 'Convert MIDI events to MusicXML and PDF using MuseScore');
    this.notes = notes;
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
    await writeFile(midiPath, notesToMidiBuffer(this.notes));
    await spawnAndWait(mscore, ['-o', xmlPath, midiPath]);
    await spawnAndWait(mscore, ['-o', pdfPath, midiPath]);

    const result: RendererResult = { musicxmlPath: xmlPath, pdfPath };
    return JSON.stringify(result);
  }
}
