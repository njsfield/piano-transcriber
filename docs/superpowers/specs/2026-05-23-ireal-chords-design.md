# iReal Pro Chord Import Design

**Date:** 2026-05-23
**Status:** Approved

## Overview

Replace the free-text chord textarea with a MusicXML file upload (iReal Pro export). The uploaded chord chart is parsed deterministically, used as harmonic context for the analysis and cleanup agents, and injected as `<harmony>` annotations into the final rendered MusicXML score.

## Architecture

The iReal Pro MusicXML file is a second optional multipart field (`chordsXml`) alongside the audio upload. A pure TypeScript parser extracts `ChordEvent[]` from it server-side. This structured data flows through the pipeline in two ways:

1. **Agent context** — chord symbols and bar positions are serialized into the analysis and cleanup agent prompts, giving the LLM harmonic grounding for deciding which notes are chord tones, tensions, or artifacts.
2. **Score annotation** — after MuseScore renders `output.musicxml`, a post-processor injects `<harmony>` elements at the correct measure/beat positions, so the final PDF and MusicXML show chord symbols above the staff.

No new agents are added. No Python dependency is required.

## Data Types

```ts
// New type in src/pipeline/types.ts
interface ChordEvent {
  measure: number;  // 1-based
  beat: number;     // 1-based, relative to measure
  symbol: string;   // e.g. "Dm7", "G7b9", "Cmaj7"
}

// AudioInput change
interface AudioInput {
  audioPath: string;
  chordsXml?: string;   // replaces chordChanges?: string
}
```

`JobState` is updated the same way (`chordsXml` replaces `chordChanges`).

## New Modules

### `src/tools/parse-chords.ts`
- Exported function: `parseChordsXml(xml: string): ChordEvent[]`
- Walks `<harmony>` elements in the MusicXML, reading `<root>`, `<kind>`, `<bass>`, and `<offset>` to build chord symbol strings and beat positions
- Throws a descriptive error if no `<harmony>` elements are found or the XML is not recognizable as MusicXML
- Pure function, no I/O, no dependencies beyond Node built-ins

### `src/tools/inject-harmonies.ts`
- Exported function: `injectHarmonies(musicxmlPath: string, chords: ChordEvent[], temposBpm: number[]): Promise<void>`
- Reads the MuseScore-rendered `output.musicxml`
- Uses the file's `<divisions>` value and the first tempo from `temposBpm` to locate the right beat position within each `<measure>`
- Inserts a `<harmony>` block before the first note at the matching beat offset
- Writes the modified XML back in place
- Skips (with a warning) any chord whose measure number exceeds the rendered score length — never throws

## Pipeline Changes (`run-pipeline.ts`)

1. Immediately after `mkdir(jobOutputDir)`: parse chords if provided
   ```ts
   const chords = input.chordsXml ? parseChordsXml(input.chordsXml) : [];
   ```
2. Analysis agent prompt: append chord list as `"bar 1: Cmaj7, bar 3: Am7, ..."` if non-empty
3. Cleanup agent prompt: same chord list appended
4. After `done('renderer')`: if chords non-empty, call `injectHarmonies(xmlPath, chords, analysis.features.temposBpm)`

## Server Changes (`server.ts`)

- Add `chordsXml` to the multer fields config (file upload, optional)
- Read the uploaded file as UTF-8 string and pass into `AudioInput`
- On parse error, return HTTP 400 before starting the pipeline

## UI Changes (`UploadForm.tsx`)

- Remove the `<textarea>` for chord changes
- Add a second `<input type="file" accept=".musicxml,.xml">` labelled "Chord chart (iReal Pro MusicXML, optional)"
- Send as `chordsXml` form field

## Error Handling

| Scenario | Behaviour |
|---|---|
| Invalid / non-MusicXML file | Server returns 400 before pipeline starts |
| No `<harmony>` elements | Same 400 — user likely uploaded the wrong file |
| Chord measure > score length | Warning logged, chord skipped, pipeline succeeds |
| No file uploaded | Pipeline runs as today, no chord context, no annotation |

## Tempo Alignment

`features.temposBpm[0]` is used as a single tempo for the whole piece. Mid-piece tempo changes are not supported in v1 — jazz standards almost never have them, and the analysis agent already detects tempo as a single value in the current schema.

## Tests

- **`parse-chords.test.ts`**: fixture iReal MusicXML snippet → expected `ChordEvent[]`; malformed/empty input → throws
- **`inject-harmonies.test.ts`**: minimal MuseScore MusicXML fixture + 2 chord events → output XML contains `<harmony>` elements at correct measures
