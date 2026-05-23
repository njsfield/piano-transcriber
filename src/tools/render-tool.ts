import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
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

// MuseScore auto-detects clefs per measure when importing MIDI, causing the treble clef
// to switch to bass and vice versa whenever pitches cross staff boundaries. We post-process
// the generated MusicXML to remove all mid-score clef changes, enforcing a fixed treble clef
// for staff 1 (RH) and bass clef for staff 2 (LH) throughout.
async function fixClefs(xmlPath: string): Promise<void> {
  let xml = await readFile(xmlPath, 'utf-8');

  // Strip every <clef ...>...</clef> block from the document.
  xml = xml.replace(/<clef[^>]*>[\s\S]*?<\/clef>/g, '');

  // Re-insert fixed clefs into the very first <attributes> block only.
  const fixedClefs =
    '<clef number="1"><sign>G</sign><line>2</line></clef>\n        ' +
    '<clef number="2"><sign>F</sign><line>4</line></clef>';
  xml = xml.replace(/<\/attributes>/, `${fixedClefs}\n        </attributes>`);

  await writeFile(xmlPath, xml, 'utf-8');
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
    await fixClefs(xmlPath);
    await spawnAndWait(mscore, ['-o', pdfPath, xmlPath]);

    const result: RendererResult = { musicxmlPath: xmlPath, pdfPath };
    return JSON.stringify(result);
  }
}
