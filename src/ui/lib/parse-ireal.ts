// src/ui/lib/parse-ireal.ts

import type { ChordEvent } from '../../pipeline/types';

export interface Song {
  title: string;
  composer: string;
  key: string;
  style: string;
  chords: ChordEvent[];
}

// iReal Pro's character-rotation obfuscation (Obihiro algorithm)
function deobfuscate(s: string): string {
  const LEN = s.length;
  if (LEN < 50) return s;

  let decoded = '';
  let i = 0;
  while (i < LEN) {
    const chunkLen = i + 50 <= LEN ? 50 : LEN - i;
    const chunk = s.slice(i, i + chunkLen);
    if (chunkLen === 50) {
      // Rotate: last 5 chars + middle 40 chars + first 5 chars
      decoded += chunk.slice(45) + chunk.slice(5, 45) + chunk.slice(0, 5);
    } else {
      decoded += chunk;
    }
    i += chunkLen;
  }
  // Second pass: swap adjacent character pairs
  let result = '';
  for (let j = 0; j < decoded.length - 1; j += 2) {
    result += decoded[j + 1] + decoded[j];
  }
  if (decoded.length % 2 !== 0) result += decoded[decoded.length - 1];
  return result;
}

function parseChordData(raw: string, timeNum: number): ChordEvent[] {
  const events: ChordEvent[] = [];
  // Strip section markers, coda, segno, spacers, etc.
  const cleaned = raw
    .replace(/\*[A-Z]/g, '')
    .replace(/[SQfx]/g, '')
    .replace(/U/g, '')
    .replace(/Y+/g, '')
    .replace(/r/g, '');

  let measure = 1;
  let beat = 1;
  let beatsPerMeasure = timeNum;
  let beatAdvance = 1;
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i]!;

    // Time signature tokens T44, T34, T54, T68, T24, T12
    if (ch === 'T' && i + 2 < cleaned.length) {
      const sig = cleaned.slice(i + 1, i + 3);
      const numMap: Record<string, number> = {
        '44': 4, '34': 3, '54': 5, '68': 6, '24': 2, '12': 12,
      };
      if (sig in numMap) {
        beatsPerMeasure = numMap[sig]!;
        i += 3;
        continue;
      }
    }

    // Barlines: advance measure
    if ('|[]{}'.includes(ch)) {
      if (beat > 1) {
        measure++;
        beat = 1;
      }
      beatAdvance = 1;
      i++;
      continue;
    }

    // Duration modifiers
    if (ch === 'h') { beatAdvance = 2; i++; continue; }
    if (ch === 'w') { beatAdvance = beatsPerMeasure; i++; continue; }
    if (ch === 'q') { beatAdvance = 1; i++; continue; }

    // Space — beat separator
    if (ch === ' ') {
      beat += beatAdvance;
      beatAdvance = 1;
      if (beat > beatsPerMeasure) {
        measure++;
        beat = 1;
      }
      i++;
      continue;
    }

    // Chord symbol: letter + optional accidental + quality + optional bass
    const chordMatch = cleaned.slice(i).match(/^([A-G][b#]?[^|[\]{} hqwTSQfxUYr]*)/);
    if (chordMatch) {
      const symbol = chordMatch[1]!.replace(/\s+/g, '').trim();
      if (symbol) {
        events.push({ measure, beat, symbol });
      }
      beat += beatAdvance;
      beatAdvance = 1;
      if (beat > beatsPerMeasure) {
        measure++;
        beat = 1;
      }
      i += chordMatch[0]!.length;
      continue;
    }

    // Unknown character — skip
    i++;
  }

  return events;
}

export function parseIRealUrl(url: string): Song[] {
  if (!url.startsWith('irealb://')) {
    throw new Error('URL must start with irealb://');
  }
  const decoded = decodeURIComponent(url.slice('irealb://'.length));
  const songStrings = decoded.split('===').filter(s => s.trim().length > 0);

  return songStrings.map((raw): Song => {
    const parts = raw.split('=');
    // Format: title=composer=style=key=n=chordData (sometimes more fields after n)
    const title = parts[0]?.trim() ?? '';
    const composer = parts[1]?.trim() ?? '';
    const style = parts[2]?.trim() ?? '';
    const key = parts[3]?.trim() ?? '';
    // parts[4] is 'n', parts[5+] is the obfuscated chord data
    const rawChords = parts.slice(5).join('=');
    const chordData = deobfuscate(rawChords);

    // Infer time signature from style
    const is34 = /waltz|3\/4/i.test(style);
    const timeNum = is34 ? 3 : 4;

    return {
      title,
      composer,
      key,
      style,
      chords: parseChordData(chordData, timeNum),
    };
  });
}
