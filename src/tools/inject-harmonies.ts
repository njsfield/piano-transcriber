import { readFile, writeFile } from 'fs/promises';
import type { ChordEvent } from '../pipeline/types';

export async function injectHarmonies(
  musicxmlPath: string,
  chords: ChordEvent[],
  _temposBpm: number[],
): Promise<void> {
  if (chords.length === 0) return;

  let xml = await readFile(musicxmlPath, 'utf-8');

  const divisionsMatch = xml.match(/<divisions>(\d+)<\/divisions>/);
  if (!divisionsMatch) return; // Not a valid rendered MusicXML, skip silently.
  const divisions = parseInt(divisionsMatch[1], 10);

  // Group chords by measure number.
  const byMeasure = new Map<number, ChordEvent[]>();
  for (const chord of chords) {
    const list = byMeasure.get(chord.measure) ?? [];
    list.push(chord);
    byMeasure.set(chord.measure, list);
  }

  xml = xml.replace(
    /<measure\s+number="(\d+)"([^>]*)>([\s\S]*?)<\/measure>/g,
    (_match, numStr: string, attrs: string, content: string) => {
      const measureNum = parseInt(numStr, 10);
      const measureChords = byMeasure.get(measureNum);
      if (!measureChords) return _match;
      const injected = injectIntoMeasure(content, measureChords, divisions, measureNum);
      return `<measure number="${numStr}"${attrs}>${injected}</measure>`;
    },
  );

  await writeFile(musicxmlPath, xml, 'utf-8');
}

function injectIntoMeasure(
  content: string,
  chords: ChordEvent[],
  divisions: number,
  measureNum: number,
): string {
  // Sort descending by beat so each insertion doesn't invalidate earlier indices.
  const sorted = [...chords].sort((a, b) => b.beat - a.beat);

  for (const chord of sorted) {
    // targetDiv: zero-indexed beat offset from the measure start, in the same unit as
    // <duration> elements. ChordEvent.beat is 1-indexed; each beat corresponds to one
    // duration unit (duration == divisions for a quarter note when divisions equals 1
    // per beat). Offset = beat - 1.
    const targetDiv = chord.beat - 1;

    // Walk notes to find insertion index.
    let cumDiv = 0;
    let insertIdx = -1;
    const noteRe = /<note>[\s\S]*?<\/note>/g;
    let m: RegExpExecArray | null;

    while ((m = noteRe.exec(content)) !== null) {
      const isChordNote = m[0].includes('<chord/>');
      if (!isChordNote) {
        if (cumDiv >= targetDiv) {
          insertIdx = m.index;
          break;
        }
        const dur = m[0].match(/<duration>(\d+)<\/duration>/);
        if (dur) cumDiv += parseInt(dur[1], 10);
      }
    }

    if (insertIdx === -1) {
      console.warn(
        `[inject-harmonies] chord "${chord.symbol}" at beat ${chord.beat} ` +
        `falls past end of measure ${measureNum}, skipping`,
      );
      continue;
    }

    const harmonyXml = buildHarmonyXml(chord.symbol);
    content = content.slice(0, insertIdx) + harmonyXml + content.slice(insertIdx);
  }

  return content;
}

function buildHarmonyXml(symbol: string): string {
  const m = symbol.match(/^([A-G])([b#]?)(.*)$/);
  if (!m) return '';
  const [, step, acc, quality] = m;
  const alter = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  const alterLine = alter !== 0 ? `\n        <root-alter>${alter}</root-alter>` : '';
  const kindValue = qualityToKind(quality);
  return (
    `\n      <harmony print-frame="no">\n` +
    `        <root>\n` +
    `          <root-step>${step}</root-step>${alterLine}\n` +
    `        </root>\n` +
    `        <kind text="${quality}">${kindValue}</kind>\n` +
    `      </harmony>\n      `
  );
}

function qualityToKind(quality: string): string {
  const map: Record<string, string> = {
    'maj7': 'major-seventh',
    'maj9': 'major-ninth',
    'maj': 'major',
    '': 'major',
    '6': 'major-sixth',
    'maj6': 'major-sixth',
    'm7': 'minor-seventh',
    'm': 'minor',
    'min': 'minor',
    'm9': 'minor-ninth',
    'm6': 'minor-sixth',
    '7': 'dominant',
    '9': 'dominant-ninth',
    '11': 'dominant-11th',
    '13': 'dominant-13th',
    'dim': 'diminished',
    'dim7': 'diminished-seventh',
    'm7b5': 'half-diminished',
    'ø': 'half-diminished',
    'aug': 'augmented',
    'sus4': 'suspended-fourth',
    'sus2': 'suspended-second',
  };
  return map[quality] ?? 'other';
}
