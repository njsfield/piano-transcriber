import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { injectHarmonies } from './inject-harmonies';
import type { ChordEvent } from '../pipeline/types';

// Minimal MuseScore-style MusicXML with two measures, 4/4, divisions=2
const SCORE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
    <measure number="2">
      <attributes></attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

let tmpPath: string;

beforeEach(async () => {
  tmpPath = join(tmpdir(), `inject-test-${Date.now()}.musicxml`);
  await writeFile(tmpPath, SCORE_XML, 'utf-8');
});

afterEach(async () => {
  await unlink(tmpPath).catch(() => {});
});

describe('injectHarmonies', () => {
  it('inserts harmony elements at correct measures', async () => {
    const chords: ChordEvent[] = [
      { measure: 1, beat: 1, symbol: 'Dm7' },
      { measure: 1, beat: 3, symbol: 'G7' },
      { measure: 2, beat: 1, symbol: 'Cmaj7' },
    ];

    await injectHarmonies(tmpPath, chords, [120]);

    const result = await readFile(tmpPath, 'utf-8');
    expect(result).toContain('<root-step>D</root-step>');
    expect(result).toContain('<kind text="m7">');
    expect(result).toContain('<root-step>G</root-step>');
    expect(result).toContain('<kind text="7">');
    expect(result).toContain('<root-step>C</root-step>');
    expect(result).toContain('<kind text="maj7">');
  });

  it('places harmony before the note at the target beat', async () => {
    const chords: ChordEvent[] = [{ measure: 1, beat: 3, symbol: 'G7' }];
    await injectHarmonies(tmpPath, chords, [120]);

    const result = await readFile(tmpPath, 'utf-8');
    // The G7 harmony should appear before the second note (beat 3, after 2 divisions)
    const harmonyIdx = result.indexOf('<root-step>G</root-step>');
    const secondNoteIdx = result.indexOf('<step>E</step>');
    expect(harmonyIdx).toBeLessThan(secondNoteIdx);
  });

  it('skips chords whose measure number exceeds the score length', async () => {
    const chords: ChordEvent[] = [{ measure: 99, beat: 1, symbol: 'Dm7' }];
    // Should not throw
    await expect(injectHarmonies(tmpPath, chords, [120])).resolves.toBeUndefined();
    const result = await readFile(tmpPath, 'utf-8');
    expect(result).not.toContain('<root-step>D</root-step>');
  });

  it('is a no-op when chords array is empty', async () => {
    await injectHarmonies(tmpPath, [], [120]);
    const result = await readFile(tmpPath, 'utf-8');
    expect(result).toBe(SCORE_XML);
  });
});
