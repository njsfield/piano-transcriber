# MIDI Recording & Improv Feedback Design

**Date:** 2026-05-24
**Status:** Approved

## Overview

Replace audio file upload with live browser-based MIDI recording. The Web MIDI API captures piano input directly; the recorded MIDI binary is uploaded to the server and parsed into `MidiEvent[]` without a Python transcription step. An iReal Pro playlist importer (paste `irealb://` URL) provides the chord chart via a persistent song sidebar. At the end of the pipeline a new `ImprovFeedbackAgent` analyses the generated MusicXML against 16 musical criteria and displays a graded feedback panel in the browser.

The existing `TranscriptionAgent` and `TranscribeTool` are retained in the codebase but removed from the active pipeline, available for future reuse.

---

## Architecture

### Data Flow

```
Browser                              Server
───────                              ──────
Web MIDI API (noteOn/noteOff)
  → serialize → MIDI binary
  → POST /api/jobs (midi + chordsJson) →  parse MIDI → MidiEvent[]
                                              ↓
                                          AnalysisAgent  (unchanged)
                                              ↓
                                          CleanupAgent   (unchanged)
                                              ↓
                                          EditorAgent    (unchanged)
                                              ↓
                                          RendererAgent  → MusicXML + PDF
                                              ↓
                                          ImprovFeedbackAgent → FeedbackResult
                                              ↓
                                          SSE: pipeline_complete + feedbackResult
Browser
  ↓
  PlaylistSidebar (localStorage)
  RecorderPanel + live note display
  PipelineProgress (6 stages)
  DownloadPanel + FeedbackPanel
```

### Pipeline Stages

| Stage | Change |
|---|---|
| transcription | **Replaced** — direct MIDI parse via `@tonejs/midi`, no agent |
| analysis | Unchanged |
| cleanup | Unchanged |
| editor | Unchanged |
| renderer | Unchanged |
| **feedback** | **New** — `ImprovFeedbackAgent` |

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/pipeline/types.ts` | `PipelineInput`, `FeedbackResult`, `CriterionResult`, `PipelineStage` |
| Modify | `src/pipeline/run-pipeline.ts` | Replace transcription stage with MIDI parse; add feedback stage |
| Modify | `src/server/server.ts` | Accept `midi` + `chordsJson` fields; make `audio` optional |
| Create | `src/tools/parse-midi.ts` | `@tonejs/midi` → `MidiEvent[]` converter |
| Create | `src/tools/feedback-tool.ts` | Reads MusicXML + chords, returns pre-processed data for agent |
| Create | `src/agents/improv-feedback-agent.ts` | Claude agent scoring 16 criteria |
| Create | `src/ui/lib/parse-ireal.ts` | `irealb://` URL → `Song[]` with `ChordEvent[]` |
| Create | `src/ui/lib/midi-recorder.ts` | Web MIDI API recording + MIDI binary serialisation |
| Modify | `src/ui/App.tsx` | Sidebar layout: `PlaylistSidebar` + `RecorderPanel` |
| Create | `src/ui/components/PlaylistSidebar.tsx` | Song list, import dialog, localStorage persistence |
| Create | `src/ui/components/RecorderPanel.tsx` | Record button, live note display, MIDI upload |
| Create | `src/ui/components/FeedbackPanel.tsx` | 16-criterion stat cards + overall grade |
| Modify | `src/ui/components/PipelineProgress.tsx` | Add `feedback` stage |
| Delete | `src/ui/components/UploadForm.tsx` | Replaced by `RecorderPanel` |
| Keep (unused) | `src/agents/transcription-agent.ts` | Retained for future reference |
| Keep (unused) | `src/tools/transcribe-tool.ts` | Retained for future reference |

---

## Types (`src/pipeline/types.ts`)

### `PipelineInput` (replaces `AudioInput`)

```ts
export interface PipelineInput {
  midiPath: string;        // path to uploaded MIDI binary on disk
  chords: ChordEvent[];    // parsed from irealb:// or from chordsXml
  chordsXml?: string;      // retained for backwards-compat with existing MusicXML upload
}
```

### `CriterionResult`

```ts
export interface CriterionResult {
  count: number;
  grade: string;       // 'A+' | 'A' | 'A-' | 'B+' … 'F' | 'n/a'
  examples: string[];  // e.g. ["m7: G#→B→D over E7 (up)"]
  note?: string;       // caveats, e.g. "grace notes unreliable"
}
```

### `FeedbackResult`

```ts
export interface FeedbackResult {
  arpeggios: CriterionResult;
  scaleRuns: CriterionResult;
  nonChordTones: CriterionResult;
  unresolvedNcts: CriterionResult;
  bluesScale: CriterionResult;
  alteredDominant: CriterionResult;
  interestingPatterns: CriterionResult;
  leaps: CriterionResult;
  motivicDevelopment: CriterionResult;
  expressiveDevices: CriterionResult;
  phraseStartBeats: CriterionResult;
  phraseEndBeats: CriterionResult;
  phraseLength: CriterionResult;
  interPhraseRest: CriterionResult;
  pitchRange: CriterionResult;
  rhythmicUnits: CriterionResult;
  overallGrade: string;
  overallNote: string;
}
```

### `PipelineStage` addition

```ts
export type PipelineStage = 'transcription' | 'analysis' | 'cleanup' | 'editor' | 'renderer' | 'feedback';
```

`RendererResult` gains `feedbackResult?: FeedbackResult`.

---

## iReal URL Parser (`src/ui/lib/parse-ireal.ts`)

**Input:** `irealb://` URL string (pasted by user)  
**Output:** `Song[]`

```ts
export interface Song {
  title: string;
  composer: string;
  key: string;
  style: string;
  chords: ChordEvent[];
}

export function parseIRealUrl(url: string): Song[]
```

### Algorithm

1. Strip `irealb://` prefix; URL-decode
2. Split on `===` → individual song strings
3. For each song: split on `=` → `[title, composer, style, key, 'n', chordData]`
4. Apply character-rotation decode to `chordData` (published algorithm; rotates specific chars by fixed offsets to reverse iReal's obfuscation)
5. Walk decoded chord string:
   - Track current measure (increment on `|`, `[`, `]`, `{`, `}` barline tokens)
   - Track current beat (advance by duration tokens `q`=1 beat, `h`=2, `w`=4; default 1 beat per chord if no token)
   - Emit `ChordEvent` for each chord symbol encountered
   - Handle time signature tokens (`T44`, `T34`, `T54`, `T68`) to set beats-per-measure
   - Handle repeat barlines: unfold first/second endings for linear `ChordEvent[]`
6. Return `Song[]`

### localStorage Schema

```ts
// key: 'ireal-playlist'
{ songs: Song[]; selectedTitle: string | null }
```

Persisted on every playlist import and every song selection. Restored on mount.

---

## MIDI Recorder (`src/ui/lib/midi-recorder.ts`)

```ts
export interface MidiRecorder {
  start(): Promise<void>;   // requests MIDI access, begins capturing
  stop(): Blob;             // serialises captured events → MIDI binary blob
  getActiveNotes(): string[]; // e.g. ["G3", "B3", "D4"] — currently held notes
  deviceName: string | null;
}
```

### Recording

- `navigator.requestMIDIAccess()` on first `start()` call
- Auto-select `inputs[0]` (first available input)
- Listen to `midimessage` events: status byte `0x90` = noteOn, `0x80` = noteOff
- Store `{ pitch, velocity, startMs }` per noteOn; on noteOff record `durationMs`
- `getActiveNotes()`: return pitch names of all noteOn events without a matching noteOff — displayed live above the record button
- `stop()`: use `@tonejs/midi` to serialise all completed notes into a standard MIDI binary `Blob`

### Note name display

MIDI pitch → note name: `['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pitch % 12] + Math.floor(pitch / 12 - 1)`  
Active notes joined with ` · ` (e.g. `G3 · B3 · D4`). Text fades/pulses with CSS animation while held; clears instantly on noteOff.

---

## Server Changes (`src/server/server.ts`)

`multer` fields updated:

```ts
upload.fields([
  { name: 'midi', maxCount: 1 },     // new: binary MIDI blob
  { name: 'audio', maxCount: 1 },    // kept (optional, ignored when midi present)
  { name: 'chordsXml', maxCount: 1 },
])
```

`chordsJson` accepted as a JSON body field (from `express.json()` middleware already present):

```ts
const chordsJson = req.body?.chordsJson as ChordEvent[] | undefined;
```

Job creation logic:
- If `midi` field present: save to disk, use as `midiPath`
- If `audio` field present and no `midi`: reject with `400 "Use MIDI recording"` (audio upload removed from UI, keep server guard)
- `chords`: use `chordsJson` if present, else parse `chordsXml` with existing `parseChordsXml`

---

## Pipeline Changes (`src/pipeline/run-pipeline.ts`)

### Transcription stage replacement

```ts
// No agent. Parse MIDI binary directly.
go('transcription');
const transcription = await parseMidi(input.midiPath);
done('transcription');
```

`parseMidi` (in `src/tools/parse-midi.ts`) uses `@tonejs/midi` to read the binary and returns `TranscriptionResult` with `MidiEvent[]` and empty `confidences: []`.

### Feedback stage (new, after renderer)

```ts
go('feedback');
const feedbackAgent = createImprovFeedbackAgent(
  renderer.musicxmlPath,
  handsAfterEdit.rightHand,  // RH notes only
  chords,
  analysis.features,
);
const feedbackResponse = await feedbackAgent.run(
  'Analyse this jazz piano improvisation and return the FeedbackResult JSON.',
);
const feedbackResult = parseOutput<FeedbackResult>(feedbackResponse);
done('feedback');
```

`RendererResult` returned by `runPipeline` gains `feedbackResult`.

---

## `parseMidi` (`src/tools/parse-midi.ts`)

```ts
import { Midi } from '@tonejs/midi';
import { readFile } from 'fs/promises';
import type { TranscriptionResult, MidiEvent } from '../pipeline/types';

export async function parseMidi(midiPath: string): Promise<TranscriptionResult> {
  const buf = await readFile(midiPath);
  const midi = new Midi(buf);
  const notes: MidiEvent[] = [];
  let idCounter = 0;
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      notes.push({
        id: String(idCounter++),
        pitch: note.midi,
        startMs: Math.round(note.time * 1000),
        durationMs: Math.round(note.duration * 1000),
        velocity: Math.round(note.velocity * 127),
      });
    }
  }
  notes.sort((a, b) => a.startMs - b.startMs);
  return { midi: notes, confidences: [] };
}
```

---

## ImprovFeedbackAgent (`src/agents/improv-feedback-agent.ts`)

Uses `claude-sonnet-4-6` (musical reasoning required; not `gpt-4o-mini`).

**`FeedbackTool`** (`src/tools/feedback-tool.ts`):
- Reads MusicXML from disk
- Extracts RH notes with measure/beat positions, pitch classes, durations
- Detects phrases (runs of notes with no internal rest ≥ 1 beat)
- Classifies rhythmic units per note (quarter/eighth/sixteenth/triplet/etc.)
- Computes pitch-class sets against active chord at each moment
- Returns pre-processed JSON — the agent prompt focuses on interpretation, not raw counting

**Agent prompt** includes:
- Pre-processed data from `FeedbackTool`
- Chord chart
- Time signature and tempo
- Exact definitions of all 16 criteria with scoring guidance
- Instruction to return a single `FeedbackResult` JSON object

### The 16 criteria

1. **Arpeggios** — 3+ consecutive notes outlining a chord, spanning ≥ a 5th
2. **Scale runs** — 4+ consecutive stepwise notes (all whole or half steps)
3. **Non-chord tones** — notes whose pitch class is not in the active chord tone set
4. **Unresolved NCTs** — NCTs not followed by a step to a chord tone within 2 notes
5. **Blues scale** — windows of 5+ notes using the blues scale (1 b3 4 b5 5 b7) of the tonic
6. **Altered dominant tensions** — b9/♯9/♯11/b13 over V7 chords
7. **Interesting scalar patterns** — direction-changing scalar fragments, enclosures (chromatic approach from both sides)
8. **Leaps** — interval ≥ a 5th within a phrase (not phrase boundary)
9. **Motivic development** — recurring 3–5 note rhythmic or contour patterns across ≥ 2 non-adjacent phrases
10. **Expressive devices** — grace notes (≤ 50ms duration), trills (rapid alternation ≥ 3 times), octave gestures
11. **Phrase start beats** — beat position of first note of each phrase (1/2/3/4/upbeat)
12. **Phrase end beats** — beat position of last note of each phrase
13. **Phrase length** — mean and median in beats
14. **Inter-phrase rest** — mean and median gap between phrases in beats
15. **Pitch range** — semitones between lowest and highest RH note
16. **Rhythmic units** — count of each rhythmic value used (whole/half/quarter/dotted-quarter/8th/8th-triplet/16th/other)

---

## UI Components

### `PlaylistSidebar.tsx`

- Fixed-width left panel (180px)
- Song list: one `<button>` per song, selected song highlighted in blue
- "Import playlist" link at the bottom → opens an inline `<textarea>` to paste the `irealb://` URL → on submit calls `parseIRealUrl()` → saves to localStorage → renders song list
- On mount: restores playlist and selected song from localStorage

### `RecorderPanel.tsx`

- Centred in remaining width
- Live note display: `<p>` above button, `G3 · B3 · D4` format, CSS pulse animation, clears on noteOff
- Record button: large circle, red idle, pulsing red while recording, shows elapsed `M:SS`
- Device name: dim small text below button (`· Yamaha P-45`)
- On stop: serialises MIDI, POSTs `FormData` with `midi` blob + `chordsJson` (JSON-stringified `ChordEvent[]` from selected song)
- Passes `jobId` to `onJobCreated` callback (existing App pattern)

### `FeedbackPanel.tsx`

- Rendered below `DownloadPanel` when `feedbackResult` is present in the job result
- 3-column responsive grid of stat cards (criterion name, count, grade badge, 1–2 example measures)
- Overall grade row at bottom with per-category badges
- No interactivity required in v1

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No MIDI device found | Record button disabled, label "No MIDI device detected" |
| MIDI access denied | Error message below button: "MIDI access denied — check browser permissions" |
| irealb:// parse fails | Inline error in paste dialog: "Could not parse playlist — paste the full irealb:// URL" |
| Recording stopped with 0 notes | POST rejected client-side: "No notes recorded" |
| Feedback agent fails | Pipeline still completes; `feedbackResult` is null; `FeedbackPanel` not shown; no error surfaced to user |

---

## Out of Scope

- Audio upload (removed from UI; server guard kept)
- Multi-device MIDI selection (auto-select first input)
- Editing or re-submitting a recording before analysis
- Exporting feedback as PDF
