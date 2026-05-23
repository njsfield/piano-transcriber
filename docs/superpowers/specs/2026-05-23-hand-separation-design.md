# Hand Separation & Grand Staff Rendering Design

**Date:** 2026-05-23
**Status:** Approved

## Overview

A chord-aware heuristic classifies transcribed MIDI notes as left hand (shell voicings) or right hand (solo improvisation). The split fixes the clef-switching rendering bug by producing a two-track MIDI that MuseScore renders as a proper piano grand staff. It also gives the analysis and cleanup agents harmonic context — knowing which notes are chord tones and which are solo lines.

## Architecture

One new pure function: `classifyHands` in `src/tools/classify-hands.ts`. It runs synchronously between the analysis and cleanup pipeline stages. No new agents, no new pipeline stages, no I/O.

The `HandSeparation` result flows in two directions:
1. **Agent context** — analysis and cleanup prompts gain a LH/RH summary so the LLM treats the harmonic layer conservatively and focuses cleanup on the solo
2. **Rendering** — `RenderTool` writes two MIDI tracks; MuseScore renders a grand staff with fixed treble (RH) and bass (LH) clefs

## New Type

```ts
// src/pipeline/types.ts
export interface HandSeparation {
  leftHand: MidiEvent[];
  rightHand: MidiEvent[];
}
```

## `classifyHands` Algorithm

**Signature:** `classifyHands(notes: MidiEvent[], chords: ChordEvent[], tempo: number, beatsPerMeasure: number): HandSeparation`

### Step 1 — Time-to-chord mapping

Convert each note's `startMs` to measure+beat position:
```
msPerBeat = 60000 / tempo
msPerMeasure = msPerBeat * beatsPerMeasure
measure = floor(startMs / msPerMeasure) + 1
beat = floor((startMs % msPerMeasure) / msPerBeat) + 1
```
Scan the chord list (sorted by measure, beat) to find the last chord whose position ≤ the note's position. That chord is active for this note.

### Step 2 — Chord tone set

Parse the active chord symbol into pitch classes using a lookup table mapping quality suffix → semitone intervals from the root. Primary chord tones are root, 3rd, and 7th. The 5th is included as a secondary tone.

Quality-to-interval map (representative):
```
''      → [0, 4, 7]          (major triad)
'maj7'  → [0, 4, 7, 11]
'6'     → [0, 4, 7, 9]
'm'     → [0, 3, 7]
'm7'    → [0, 3, 7, 10]
'm6'    → [0, 3, 7, 9]
'7'     → [0, 4, 7, 10]
'9'     → [0, 4, 7, 10, 2]
'dim'   → [0, 3, 6]
'dim7'  → [0, 3, 6, 9]
'm7b5'  → [0, 3, 6, 10]
'aug'   → [0, 4, 8]
'sus4'  → [0, 5, 7]
'sus2'  → [0, 2, 7]
'maj9'  → [0, 4, 7, 11, 2]
'11'    → [0, 4, 7, 10, 2, 5]
'13'    → [0, 4, 7, 10, 2, 5, 9]
```

Root pitch class from symbol: parse root-step (A–G) + accidental (b → -1, # → +1) → MIDI pitch class 0–11. Add intervals modulo 12 to get the chord tone set.

### Step 3 — Classification

A note is **left hand** if ALL of:
- `pitch ≤ 64` (E4 — practical ceiling for shell voicings)
- `pitch % 12` matches any pitch class in the active chord tone set

Everything else is **right hand**.

**Fallback (no chord or no chart):** split at MIDI 60 (middle C) — below → LH, at/above → RH.

## Pipeline Changes (`run-pipeline.ts`)

New stage between analysis and cleanup:

```
transcription → analysis → classifyHands → cleanup → editor → renderer
```

```ts
import { classifyHands } from '../tools/classify-hands';

const beatsPerMeasure = parseInt(analysis.features.timeSignature.split('/')[0] ?? '4', 10);
const hands = classifyHands(
  transcription.midi,
  chords,
  analysis.features.temposBpm[0] ?? 120,
  beatsPerMeasure,
);
```

**Analysis prompt addition** (appended to existing chord context):
```
Left hand (shell voicings): ${hands.leftHand.length} notes
Right hand (solo): ${hands.rightHand.length} notes
```

**Cleanup prompt addition** (appended):
```
Left-hand shell voicing notes are chord tones — be very conservative with them.
Right-hand solo notes are the improvisation — apply normal cleanup judgment.
Left hand note IDs: [${hands.leftHand.map(n => n.id).join(', ')}]
```

**Renderer:** `createRendererAgent(editor.midi, outputDir)` becomes `createRendererAgent(handsAfterEdit, outputDir)` where `handsAfterEdit` re-applies the LH/RH split to the edited MIDI (by ID lookup).

## `RenderTool` Changes

Constructor changes from `(notes: MidiEvent[], outputDir)` to `(leftHand: MidiEvent[], rightHand: MidiEvent[], outputDir)`.

`notesToMidiBuffer` writes two tracks:
- Track 0, channel 0: right hand notes
- Track 1, channel 1: left hand notes

If one hand is empty, only one track is written (single-staff fallback).

## Re-applying Hand Split After Editing

The editor operates on the flat `editor.midi` array (all notes combined). After editing, re-split by ID:

```ts
const lhIds = new Set(hands.leftHand.map(n => n.id));
const handsAfterEdit = {
  leftHand: editor.midi.filter(n => lhIds.has(n.id)),
  rightHand: editor.midi.filter(n => !lhIds.has(n.id)),
};
```

Notes deleted by the editor simply won't appear in either set.

## Error Handling

| Scenario | Behaviour |
|---|---|
| No chord chart uploaded | `classifyHands` uses pitch split at MIDI 60 — two staves, no chord awareness |
| Empty left or right hand | Single-staff render (omit empty track) |
| Note has no active chord | Pitch-split fallback for that note only |
| Unknown chord quality suffix | Treat as major triad `[0, 4, 7]` |

## Files Changed

| Action | Path |
|---|---|
| Create | `src/tools/classify-hands.ts` |
| Create | `src/tools/classify-hands.test.ts` |
| Modify | `src/pipeline/types.ts` — add `HandSeparation` |
| Modify | `src/pipeline/run-pipeline.ts` — add classify step, updated prompts, re-split after edit |
| Modify | `src/tools/render-tool.ts` — two-track MIDI, new constructor |
| Modify | `src/agents/renderer-agent.ts` — updated constructor call |

## Tests

- `classifyHands`: fixture notes + chords → correct LH/RH classification; low non-chord-tone goes RH; no-chords fallback to pitch split
- Chord tone parsing: "Dm7" → `{2, 5, 9, 0}`; "Amaj7" → `{9, 1, 4, 8}`; unknown quality → `[0, 4, 7]`
- `RenderTool`: two-track buffer has two tracks; single-hand input produces one track
