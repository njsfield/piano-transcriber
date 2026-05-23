import type { ChordEvent } from '../pipeline/types';

export function parseChordsXml(xml: string): ChordEvent[] {
  const divisionsMatch = xml.match(/<divisions>(\d+)<\/divisions>/);
  if (!divisionsMatch) {
    throw new Error('Not a valid MusicXML file: missing <divisions>');
  }
  const divisions = parseInt(divisionsMatch[1], 10);
  if (divisions <= 0) {
    throw new Error('Not a valid MusicXML file: <divisions> must be a positive integer');
  }

  const chords: ChordEvent[] = [];
  const measureRe = /<measure\s+number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g;
  let measureMatch: RegExpExecArray | null;

  while ((measureMatch = measureRe.exec(xml)) !== null) {
    const measureNum = parseInt(measureMatch[1], 10);
    const content = measureMatch[2];
    let cumulativeDivisions = 0;

    // Walk top-level child elements in document order.
    // harmony → record chord at current beat; note/forward/backup → advance beat counter.
    const elementRe = /<(harmony|note|backup|forward)[\s\S]*?<\/\1>/g;
    let elemMatch: RegExpExecArray | null;

    while ((elemMatch = elementRe.exec(content)) !== null) {
      const tag = elemMatch[1];
      const body = elemMatch[0];

      if (tag === 'harmony') {
        const symbol = extractSymbol(body);
        if (symbol) {
          const beat = cumulativeDivisions / divisions + 1;
          chords.push({ measure: measureNum, beat, symbol });
        }
      } else if (tag === 'note') {
        // Chord notes share the beat position of the previous note — don't advance.
        if (!body.includes('<chord/>')) {
          const dur = body.match(/<duration>(\d+)<\/duration>/);
          if (dur) cumulativeDivisions += parseInt(dur[1], 10);
        }
      } else if (tag === 'backup') {
        const dur = body.match(/<duration>(\d+)<\/duration>/);
        if (dur) cumulativeDivisions -= parseInt(dur[1], 10);
      } else if (tag === 'forward') {
        const dur = body.match(/<duration>(\d+)<\/duration>/);
        if (dur) cumulativeDivisions += parseInt(dur[1], 10);
      }
    }
  }

  if (chords.length === 0) {
    throw new Error(
      'No chord symbols found in MusicXML. Make sure this is an iReal Pro chord chart export.',
    );
  }

  return chords;
}

function extractSymbol(harmonyXml: string): string | null {
  const stepMatch = harmonyXml.match(/<root-step>([A-G])<\/root-step>/);
  if (!stepMatch) return null;

  const step = stepMatch[1];
  const alterMatch = harmonyXml.match(/<root-alter>([-\d.]+)<\/root-alter>/);
  const alter = alterMatch ? parseFloat(alterMatch[1]) : 0;
  const accidental = alter <= -2 ? 'bb' : alter === -1 ? 'b' : alter >= 2 ? '##' : alter === 1 ? '#' : '';

  // iReal Pro always sets the `text` attribute on <kind> to the display quality string.
  const kindMatch = harmonyXml.match(/<kind[^>]+text="([^"]*)"[^>]*>/);
  const quality = kindMatch ? kindMatch[1] : '';

  return `${step}${accidental}${quality}`;
}
