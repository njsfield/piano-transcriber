# iReal Pro Chord Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept an iReal Pro MusicXML export alongside the audio upload, use it as harmonic context for the analysis and cleanup agents, and inject the chord symbols as `<harmony>` annotations in the final rendered score.

**Architecture:** A pure-TypeScript parser (`parse-chords.ts`) extracts `ChordEvent[]` from the iReal MusicXML before the pipeline starts. Chord symbols are serialised into the analysis and cleanup agent prompts as plain text. After MuseScore renders `output.musicxml`, a post-processor (`inject-harmonies.ts`) inserts `<harmony>` elements at the correct measure/beat positions using the rendered file's own `<divisions>` value.

**Tech Stack:** TypeScript, Node.js built-ins (fs/promises, string/regex XML walking), Vitest, React.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/tools/parse-chords.ts` | Parse iReal MusicXML → `ChordEvent[]` |
| Create | `src/tools/parse-chords.test.ts` | Unit tests for parser |
| Create | `src/tools/inject-harmonies.ts` | Post-process rendered MusicXML to add `<harmony>` elements |
| Create | `src/tools/inject-harmonies.test.ts` | Unit tests for injector |
| Modify | `src/pipeline/types.ts` | Add `ChordEvent`; replace `chordChanges` with `chordsXml` on `AudioInput` and `JobState` |
| Modify | `src/pipeline/run-pipeline.ts` | Parse chords, pass to agents, call `injectHarmonies` post-render |
| Modify | `src/server/server.ts` | Accept `chordsXml` file field, validate, pass to pipeline |
| Modify | `src/ui/components/UploadForm.tsx` | Replace chord textarea with `.musicxml` file input |

---

## Task 1: Add `ChordEvent` type and update `AudioInput`

**Files:**
- Modify: `src/pipeline/types.ts`

- [ ] **Step 1: Edit `src/pipeline/types.ts`**

Add `ChordEvent` and update `AudioInput` and `JobState`:

```ts
// Add after the MidiEvent interface:
export interface ChordEvent {
  measure: number; // 1-based
  beat: number;    // 1-based, within the measure
  symbol: string;  // e.g. "Dm7", "G7", "Amaj7"
}
```

Replace:
```ts
export interface AudioInput {
  audioPath: string;
  chordChanges?: string;
}
```
With:
```ts
export interface AudioInput {
  audioPath: string;
  chordsXml?: string;
}
```

Replace in `JobState`:
```ts
  chordChanges?: string;
```
With:
```ts
  chordsXml?: string;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
yarn typecheck
```

Expected: errors only about `chordChanges` references in `run-pipeline.ts` and `server.ts` (those are fixed in later tasks) — no errors in `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/types.ts
git commit -m "feat: add ChordEvent type, replace chordChanges with chordsXml on AudioInput"
```

---

## Task 2: Implement `parseChordsXml`

**Files:**
- Create: `src/tools/parse-chords.ts`
- Create: `src/tools/parse-chords.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tools/parse-chords.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test src/tools/parse-chords.test.ts
```

Expected: FAIL — `Cannot find module './parse-chords'`

- [ ] **Step 3: Implement `parseChordsXml`**

Create `src/tools/parse-chords.ts`:

```ts
import type { ChordEvent } from '../pipeline/types';

export function parseChordsXml(xml: string): ChordEvent[] {
  const divisionsMatch = xml.match(/<divisions>(\d+)<\/divisions>/);
  if (!divisionsMatch) {
    throw new Error('Not a valid MusicXML file: missing <divisions>');
  }
  const divisions = parseInt(divisionsMatch[1], 10);

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
  const accidental = alter < 0 ? 'b' : alter > 0 ? '#' : '';

  // iReal Pro always sets the `text` attribute on <kind> to the display quality string.
  const kindMatch = harmonyXml.match(/<kind[^>]+text="([^"]*)"[^>]*>/);
  const quality = kindMatch ? kindMatch[1] : '';

  return `${step}${accidental}${quality}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test src/tools/parse-chords.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/parse-chords.ts src/tools/parse-chords.test.ts
git commit -m "feat: implement parseChordsXml to extract ChordEvent[] from iReal MusicXML"
```

---

## Task 3: Implement `injectHarmonies`

**Files:**
- Create: `src/tools/inject-harmonies.ts`
- Create: `src/tools/inject-harmonies.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tools/inject-harmonies.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test src/tools/inject-harmonies.test.ts
```

Expected: FAIL — `Cannot find module './inject-harmonies'`

- [ ] **Step 3: Implement `injectHarmonies`**

Create `src/tools/inject-harmonies.ts`:

```ts
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
  // Sort descending by beat so each insertion doesn't invalidate later indices.
  const sorted = [...chords].sort((a, b) => b.beat - a.beat);

  for (const chord of sorted) {
    const targetDiv = Math.round((chord.beat - 1) * divisions);

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test src/tools/inject-harmonies.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/inject-harmonies.ts src/tools/inject-harmonies.test.ts
git commit -m "feat: implement injectHarmonies to annotate rendered MusicXML with chord symbols"
```

---

## Task 4: Wire chords through the pipeline

**Files:**
- Modify: `src/pipeline/run-pipeline.ts`

- [ ] **Step 1: Update imports and parse chords at pipeline start**

In `src/pipeline/run-pipeline.ts`, add the imports at the top:

```ts
import { parseChordsXml } from '../tools/parse-chords';
import { injectHarmonies } from '../tools/inject-harmonies';
import type { ChordEvent } from './types';
```

After `await mkdir(jobOutputDir, { recursive: true });`, add:

```ts
  const chords: ChordEvent[] = input.chordsXml ? parseChordsXml(input.chordsXml) : [];
```

- [ ] **Step 2: Add chord context to the analysis agent prompt**

Find the analysis agent run call:

```ts
  const analysisResponse = await analysisAgent.run(
    `Analyse the MIDI transcription. Use both the extract_features and flag_suspicious tools, then return the combined result as JSON.`,
  );
```

Replace with:

```ts
  const chordContext = chords.length > 0
    ? `\nChord chart: ${chords.map(c => `bar ${c.measure} beat ${c.beat}: ${c.symbol}`).join(', ')}`
    : '';
  const analysisResponse = await analysisAgent.run(
    `Analyse the MIDI transcription. Use both the extract_features and flag_suspicious tools, then return the combined result as JSON.${chordContext}`,
  );
```

- [ ] **Step 3: Add chord context to the cleanup agent prompt**

Find the cleanup task construction:

```ts
  const cleanupTask = [
    `Review this jazz piano transcription for cleanup.`,
    `\nMIDI events (${transcription.midi.length} notes):\n${JSON.stringify(transcription.midi)}`,
    `\nDetected issues:\n${JSON.stringify(analysis.issues)}`,
    input.chordChanges ? `\nChord changes:\n${input.chordChanges}` : '',
    `\nReturn the operations JSON.`,
  ].join('');
```

Replace with:

```ts
  const cleanupTask = [
    `Review this jazz piano transcription for cleanup.`,
    `\nMIDI events (${transcription.midi.length} notes):\n${JSON.stringify(transcription.midi)}`,
    `\nDetected issues:\n${JSON.stringify(analysis.issues)}`,
    chords.length > 0
      ? `\nChord chart: ${chords.map(c => `bar ${c.measure} beat ${c.beat}: ${c.symbol}`).join(', ')}`
      : '',
    `\nReturn the operations JSON.`,
  ].join('');
```

- [ ] **Step 4: Inject harmonies after rendering**

After `done('renderer');` and before `return renderer;`, add:

```ts
  if (chords.length > 0) {
    const xmlAbsPath = require('path').join(process.cwd(), renderer.musicxmlPath.replace(/^\//, ''));
    await injectHarmonies(xmlAbsPath, chords, analysis.features.temposBpm);
  }
```

Wait — `renderer.musicxmlPath` is already an absolute path at this point (it becomes a URL path only after the `.then` in `server.ts`). The `RenderTool` writes to `join(outputDir, 'output.musicxml')` and returns that absolute path. So use it directly:

```ts
  if (chords.length > 0) {
    await injectHarmonies(renderer.musicxmlPath, chords, analysis.features.temposBpm);
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
yarn typecheck
```

Expected: errors only about `chordChanges` in `server.ts` (fixed in Task 5). No errors in `run-pipeline.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/run-pipeline.ts
git commit -m "feat: wire chord parsing and harmony injection through pipeline"
```

---

## Task 5: Update the server to accept a MusicXML file upload

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: Change multer from `single` to `fields`**

Find:

```ts
const upload = multer({
  dest: "tmp/uploads/",
```

The `upload.single("audio")` call is used in the route. Find and replace:

```ts
app.post("/api/jobs", upload.single("audio"), (req, res) => {
```

With:

```ts
app.post("/api/jobs", upload.fields([{ name: "audio", maxCount: 1 }, { name: "chordsXml", maxCount: 1 }]), (req, res) => {
```

- [ ] **Step 2: Update the request handler body**

`req.file` no longer exists with `fields` — use `req.files`. Find:

```ts
  if (!req.file) {
    res.status(400).json({ error: "audio file required" });
    return;
  }
  const jobId = randomUUID();
  const audioPath = path.resolve(req.file.path);
  const chordChanges =
    typeof req.body["chords"] === "string" ? req.body["chords"] : undefined;
  const jobOutputDir = path.join(JOBS_DIR, jobId);

  store.create(jobId, { audioPath, chordChanges });
```

Replace with:

```ts
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const audioFile = files?.["audio"]?.[0];
  const chordsFile = files?.["chordsXml"]?.[0];

  if (!audioFile) {
    res.status(400).json({ error: "audio file required" });
    return;
  }

  let chordsXml: string | undefined;
  if (chordsFile) {
    try {
      const { readFileSync } = await import("fs");
      const rawXml = readFileSync(chordsFile.path, "utf-8");
      // Validate it looks like MusicXML before letting it into the pipeline.
      if (!rawXml.includes("<harmony>")) {
        res.status(400).json({ error: "chordsXml file contains no chord symbols. Upload an iReal Pro MusicXML export." });
        return;
      }
      chordsXml = rawXml;
    } catch (err) {
      res.status(400).json({ error: "Failed to read chordsXml file" });
      return;
    }
  }

  const jobId = randomUUID();
  const audioPath = path.resolve(audioFile.path);
  const jobOutputDir = path.join(JOBS_DIR, jobId);

  store.create(jobId, { audioPath, chordsXml });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/server.ts
git commit -m "feat: accept optional chordsXml MusicXML file upload in POST /api/jobs"
```

---

## Task 6: Update the UI

**Files:**
- Modify: `src/ui/components/UploadForm.tsx`

- [ ] **Step 1: Replace the chord textarea with a file input**

Replace the entire content of `src/ui/components/UploadForm.tsx` with:

```tsx
import { useState, useRef } from 'react';

interface Props {
  onJobCreated: (jobId: string) => void;
}

export function UploadForm({ onJobCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const chordsRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const audioFile = audioRef.current?.files?.[0];
    if (!audioFile) { setError('Please select an audio file'); return; }

    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append('audio', audioFile);
    const chordsFile = chordsRef.current?.files?.[0];
    if (chordsFile) form.append('chordsXml', chordsFile);

    try {
      const res = await fetch('/api/jobs', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server error: ${res.status}`);
      }
      const { jobId } = await res.json() as { jobId: string };
      onJobCreated(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg mx-auto">
      <div>
        <label className="block text-sm font-medium mb-1">Audio file (WAV or M4A)</label>
        <input
          ref={audioRef}
          type="file"
          accept=".wav,.m4a,audio/wav,audio/x-m4a"
          className="block w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">
          Chord chart — iReal Pro MusicXML export (optional)
        </label>
        <input
          ref={chordsRef}
          type="file"
          accept=".musicxml,.xml"
          className="block w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900"
        />
        <p className="text-xs text-zinc-500 mt-1">
          In iReal Pro: share song → MusicXML
        </p>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium"
      >
        {loading ? 'Uploading…' : 'Transcribe'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/UploadForm.tsx
git commit -m "feat: replace chord textarea with iReal Pro MusicXML file input"
```

---

## Task 7: Run all tests and verify end-to-end

- [ ] **Step 1: Run the full test suite**

```bash
yarn test
```

Expected: all tests pass including the new `parse-chords` and `inject-harmonies` suites.

- [ ] **Step 2: Start the dev server and do a manual smoke test without chords**

```bash
yarn dev
```

Upload an audio file without a chord chart. Verify the pipeline completes and the PDF downloads as before.

- [ ] **Step 3: Manual smoke test with iReal Pro MusicXML**

Upload an audio file AND the `Bye Bye Blackbird.musicxml` from iReal Pro. Verify:
- Pipeline completes successfully
- The downloaded MusicXML contains `<harmony>` elements (open it in a text editor)
- The PDF shows chord symbols above the staff when opened in MuseScore

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: post-integration cleanup"
```
