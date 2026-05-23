import { describe, it, expect } from 'vitest';
import { parseChordsXml } from './parse-chords';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>768</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony>
        <root><root-step>D</root-step></root>
        <kind text="m7">minor-seventh</kind>
      </harmony>
      <note><rest/><duration>1536</duration><type>half</type></note>
      <harmony>
        <root><root-step>G</root-step></root>
        <kind text="7">dominant</kind>
      </harmony>
      <note><rest/><duration>1536</duration><type>half</type></note>
    </measure>
    <measure number="2">
      <attributes></attributes>
      <harmony>
        <root><root-step>C</root-step><root-alter>1</root-alter></root>
        <kind text="m">minor</kind>
      </harmony>
      <note><rest/><duration>3072</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

describe('parseChordsXml', () => {
  it('extracts chord events with correct measure, beat, and symbol', () => {
    const chords = parseChordsXml(FIXTURE);
    expect(chords).toHaveLength(3);
    expect(chords[0]).toEqual({ measure: 1, beat: 1, symbol: 'Dm7' });
    expect(chords[1]).toEqual({ measure: 1, beat: 3, symbol: 'G7' });
    expect(chords[2]).toEqual({ measure: 2, beat: 1, symbol: 'C#m' });
  });

  it('throws when no harmony elements are found', () => {
    const noChords = FIXTURE.replace(/<harmony>[\s\S]*?<\/harmony>/g, '');
    expect(() => parseChordsXml(noChords)).toThrow('No chord symbols found');
  });

  it('throws when divisions element is missing', () => {
    const noDivisions = FIXTURE.replace(/<divisions>768<\/divisions>/, '');
    expect(() => parseChordsXml(noDivisions)).toThrow('missing <divisions>');
  });

  it('does not advance beat position for chord notes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <harmony>
        <root><root-step>C</root-step></root>
        <kind text="maj7">major-seventh</kind>
      </harmony>
      <note><rest/><duration>2</duration><type>half</type></note>
      <note><chord/><rest/><duration>2</duration><type>half</type></note>
      <note><rest/><duration>2</duration><type>half</type></note>
      <harmony>
        <root><root-step>F</root-step></root>
        <kind text="7">dominant</kind>
      </harmony>
    </measure>
  </part>
</score-partwise>`;
    const chords = parseChordsXml(xml);
    expect(chords).toHaveLength(2);
    expect(chords[0]).toEqual({ measure: 1, beat: 1, symbol: 'Cmaj7' });
    expect(chords[1]).toEqual({ measure: 1, beat: 3, symbol: 'F7' });
  });
});
