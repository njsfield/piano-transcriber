# Piano Transcriber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a five-agent TypeScript pipeline that accepts a WAV/M4A recording, transcribes it via basic-pitch, cleans it up with GPT reasoning, and delivers downloadable MusicXML + PDF sheet music through a React UI with live SSE progress.

**Architecture:** Five `OpenAIAgent` instances run sequentially — each wraps `BaseTool` subclasses as its only interface to external systems. The Express server manages jobs in memory, streams SSE progress events, and serves output files statically. A minimal Python FastAPI service handles only the basic-pitch transcription step.

**Tech Stack:** TypeScript, React 19, Express 5, Vite, Tailwind, `@tonejs/midi`, `multer`; Python FastAPI + basic-pitch; MuseScore CLI

---

## File Map

**New files:**
```
src/pipeline/types.ts                   All shared pipeline types
src/pipeline/run-pipeline.ts            Sequential async pipeline orchestrator
src/tools/transcribe-tool.ts            HTTP POST to Python /transcribe
src/tools/extract-features-tool.ts      TS tempo/key/time-sig from MidiEvent[]
src/tools/flag-suspicious-tool.ts       TS short-note + rhythmic outlier detection
src/tools/apply-operations-tool.ts      TS MIDI array mutation
src/tools/render-tool.ts                MuseScore CLI via child_process.spawn
src/tools/extract-features-tool.test.ts
src/tools/flag-suspicious-tool.test.ts
src/tools/apply-operations-tool.test.ts
src/agents/transcription-agent.ts       OpenAIAgent factory + instructions
src/agents/analysis-agent.ts
src/agents/cleanup-agent.ts
src/agents/editor-agent.ts
src/agents/renderer-agent.ts
src/server/job-store.ts                 In-memory job state + SSE subscriber map
src/server/job-store.test.ts
src/server/server.ts                    Express routes + SSE + static file serving
src/ui/main.tsx                         Vite entry point
src/ui/App.tsx                          View router (upload ↔ progress)
src/ui/components/UploadForm.tsx
src/ui/components/PipelineProgress.tsx
src/ui/components/DownloadPanel.tsx
python/main.py                          FastAPI + basic-pitch transcription endpoint
python/requirements.txt
```

**Modified files:**
```
package.json       add @tonejs/midi, multer, @types/multer
vite.config.ts     add /api proxy to Express :3001
```

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Add runtime dependencies**

```bash
yarn add @tonejs/midi multer
yarn add -D @types/multer
```

- [ ] **Step 2: Verify install**

```bash
yarn tsc --noEmit
```

Expected: no new errors (existing errors are pre-existing).

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add @tonejs/midi and multer dependencies"
```

---

## Task 2: Shared pipeline types

**Files:**
- Create: `src/pipeline/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/pipeline/types.ts

export interface MidiEvent {
  id: string;
  pitch: number;
  startMs: number;
  durationMs: number;
  velocity: number;
}

export interface NoteConfidence {
  noteId: string;
  confidence: number;
}

export interface MusicFeatures {
  temposBpm: number[];
  key: string;
  timeSignature: string;
}

export type IssueType = 'short_note' | 'rhythmic_outlier';
export type IssueSeverity = 'low' | 'medium' | 'high';

export interface Issue {
  noteId: string;
  type: IssueType;
  description: string;
  severity: IssueSeverity;
}

export type EditOperationType = 'keep' | 'delete' | 'respell' | 'requantize';

export interface EditOperation {
  type: EditOperationType;
  noteId: string;
  newPitch?: number;
  newDurationMs?: number;
}

export interface AudioInput {
  audioPath: string;
  chordChanges?: string;
}

export interface TranscriptionResult {
  midi: MidiEvent[];
  confidences: NoteConfidence[];
}

export interface AnalysisResult {
  features: MusicFeatures;
  issues: Issue[];
}

export interface CleanupResult {
  operations: EditOperation[];
}

export interface EditorResult {
  midi: MidiEvent[];
}

export interface RendererResult {
  musicxmlPath: string;
  pdfPath: string;
}

export type PipelineStage = 'transcription' | 'analysis' | 'cleanup' | 'editor' | 'renderer';
export type PipelineEventType = 'stage_start' | 'stage_complete' | 'stage_error' | 'pipeline_complete';

export interface PipelineEvent {
  type: PipelineEventType;
  stage?: PipelineStage;
  error?: string;
  result?: RendererResult;
}

export type JobStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface JobState {
  id: string;
  status: JobStatus;
  audioPath: string;
  chordChanges?: string;
  result?: RendererResult;
  error?: string;
  createdAt: Date;
  events: PipelineEvent[];
}
```

- [ ] **Step 2: Type-check**

```bash
yarn tsc --noEmit
```

Expected: passes with no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/types.ts
git commit -m "feat: add shared pipeline types"
```

---

## Task 3: Python transcription service

**Files:**
- Create: `python/main.py`
- Create: `python/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
# python/requirements.txt
basic-pitch
fastapi
uvicorn[standard]
python-multipart
```

- [ ] **Step 2: Create main.py**

```python
# python/main.py
import os
import uuid
import tempfile
from typing import List

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


class MidiEvent(BaseModel):
    id: str
    pitch: int
    startMs: float
    durationMs: float
    velocity: int


class NoteConfidence(BaseModel):
    noteId: str
    confidence: float


class TranscribeResponse(BaseModel):
    midi: List[MidiEvent]
    confidences: List[NoteConfidence]


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH

        _model_output, _midi_data, note_events = predict(tmp_path)

        midi_events: List[MidiEvent] = []
        confidences: List[NoteConfidence] = []

        for note in note_events:
            # note_events format: (start_time_s, end_time_s, pitch, amplitude, pitch_bends)
            start_s, end_s, pitch, amplitude, *_ = note
            note_id = str(uuid.uuid4())
            midi_events.append(MidiEvent(
                id=note_id,
                pitch=int(pitch),
                startMs=float(start_s * 1000),
                durationMs=float((end_s - start_s) * 1000),
                velocity=int(min(127, amplitude * 127)),
            ))
            confidences.append(NoteConfidence(
                noteId=note_id,
                confidence=float(amplitude),
            ))

        return TranscribeResponse(midi=midi_events, confidences=confidences)
    finally:
        os.unlink(tmp_path)
```

- [ ] **Step 3: Test the service manually**

```bash
cd python
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

In a separate terminal (with a real WAV file):
```bash
curl -X POST http://localhost:8000/transcribe \
  -F "audio=@/path/to/sample.wav" | python3 -m json.tool | head -40
```

Expected: JSON with `midi` array and `confidences` array.

- [ ] **Step 4: Commit**

```bash
git add python/
git commit -m "feat: add Python basic-pitch transcription service"
```

---

## Task 4: TranscribeTool

**Files:**
- Create: `src/tools/transcribe-tool.ts`
- Create: `src/tools/transcribe-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/transcribe-tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscribeTool } from './transcribe-tool';

const mockResult = {
  midi: [{ id: 'n1', pitch: 60, startMs: 0, durationMs: 500, velocity: 80 }],
  confidences: [{ noteId: 'n1', confidence: 0.9 }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockResult,
  }));
});

describe('TranscribeTool', () => {
  it('posts audio file to python service and returns JSON string', async () => {
    const tool = new TranscribeTool('http://localhost:8000');
    const result = await tool.execute({ audioPath: '/tmp/test.wav' });
    expect(JSON.parse(result as string)).toEqual(mockResult);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/transcribe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));
    const tool = new TranscribeTool('http://localhost:8000');
    await expect(tool.execute({ audioPath: '/tmp/test.wav' })).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/tools/transcribe-tool.test.ts
```

Expected: FAIL — `TranscribeTool` not found.

- [ ] **Step 3: Implement TranscribeTool**

```typescript
// src/tools/transcribe-tool.ts
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';

export class TranscribeTool extends BaseTool {
  private pythonServiceUrl: string;

  constructor(pythonServiceUrl: string) {
    super('transcribe_audio', 'Transcribe an audio file to MIDI events with per-note confidence scores using basic-pitch');
    this.pythonServiceUrl = pythonServiceUrl;
  }

  get parameters(): ToolParameters {
    return {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: 'Absolute path to the audio file (WAV or M4A)',
        },
      },
      required: ['audioPath'],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const audioPath = String(params['audioPath']);
    const fileBuffer = await readFile(audioPath);
    const blob = new Blob([fileBuffer]);
    const form = new FormData();
    form.append('audio', blob, basename(audioPath));

    const response = await fetch(`${this.pythonServiceUrl}/transcribe`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Transcription service error: ${response.status} ${response.statusText}`);
    }

    return JSON.stringify(await response.json());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test src/tools/transcribe-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/transcribe-tool.ts src/tools/transcribe-tool.test.ts
git commit -m "feat: add TranscribeTool"
```

---

## Task 5: ExtractFeaturesTool

**Files:**
- Create: `src/tools/extract-features-tool.ts`
- Create: `src/tools/extract-features-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/extract-features-tool.test.ts
import { describe, it, expect } from 'vitest';
import { ExtractFeaturesTool } from './extract-features-tool';
import type { MidiEvent } from '../pipeline/types';

function makeNote(id: string, pitch: number, startMs: number, durationMs: number): MidiEvent {
  return { id, pitch, startMs, durationMs, velocity: 80 };
}

describe('ExtractFeaturesTool', () => {
  it('returns 4/4 as time signature placeholder', async () => {
    const notes = [makeNote('a', 60, 0, 500), makeNote('b', 62, 500, 500)];
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.timeSignature).toBe('4/4');
  });

  it('estimates tempo from inter-onset intervals', async () => {
    // Quarter notes at 120 BPM = 500ms apart
    const notes = Array.from({ length: 8 }, (_, i) =>
      makeNote(`n${i}`, 60 + i, i * 500, 400),
    );
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.temposBpm[0]).toBeGreaterThan(100);
    expect(result.temposBpm[0]).toBeLessThan(140);
  });

  it('estimates key as a string containing "major" or "minor"', async () => {
    // C major chord
    const notes = [60, 64, 67, 72, 64, 67].map((pitch, i) =>
      makeNote(`n${i}`, pitch, i * 300, 250),
    );
    const tool = new ExtractFeaturesTool(notes);
    const result = JSON.parse(await tool.execute({}) as string);
    expect(result.key).toMatch(/major|minor/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/tools/extract-features-tool.test.ts
```

Expected: FAIL — `ExtractFeaturesTool` not found.

- [ ] **Step 3: Implement ExtractFeaturesTool**

```typescript
// src/tools/extract-features-tool.ts
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, MusicFeatures } from '../pipeline/types';

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function rotate(arr: number[], n: number): number[] {
  return [...arr.slice(n), ...arr.slice(0, n)];
}

function pearson(a: number[], b: number[]): number {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

function estimateTempo(notes: MidiEvent[]): number {
  if (notes.length < 2) return 120;
  const onsets = notes.map(n => n.startMs).sort((a, b) => a - b);
  const iois = onsets.slice(1)
    .map((t, i) => t - onsets[i])
    .filter(ioi => ioi > 50);
  if (!iois.length) return 120;
  iois.sort((a, b) => a - b);
  const median = iois[Math.floor(iois.length / 2)]!;
  return Math.round(60000 / median);
}

function estimateKey(notes: MidiEvent[]): string {
  const histogram = new Array(12).fill(0) as number[];
  for (const note of notes) histogram[note.pitch % 12] += note.durationMs;
  const total = histogram.reduce((s, v) => s + v, 0);
  if (total === 0) return 'C major';
  const norm = histogram.map(v => v / total);

  let bestKey = 'C major';
  let bestCorr = -Infinity;
  for (let root = 0; root < 12; root++) {
    const maj = pearson(norm, rotate(KS_MAJOR, root));
    if (maj > bestCorr) { bestCorr = maj; bestKey = `${NOTE_NAMES[root]} major`; }
    const min = pearson(norm, rotate(KS_MINOR, root));
    if (min > bestCorr) { bestCorr = min; bestKey = `${NOTE_NAMES[root]} minor`; }
  }
  return bestKey;
}

export class ExtractFeaturesTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('extract_features', 'Extract tempo, key, and time signature from the MIDI note events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  execute(_params: Record<string, unknown>): string {
    const features: MusicFeatures = {
      temposBpm: [estimateTempo(this.notes)],
      key: estimateKey(this.notes),
      timeSignature: '4/4',
    };
    return JSON.stringify(features);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test src/tools/extract-features-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/extract-features-tool.ts src/tools/extract-features-tool.test.ts
git commit -m "feat: add ExtractFeaturesTool with tempo and key estimation"
```

---

## Task 6: FlagSuspiciousTool

**Files:**
- Create: `src/tools/flag-suspicious-tool.ts`
- Create: `src/tools/flag-suspicious-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/flag-suspicious-tool.test.ts
import { describe, it, expect } from 'vitest';
import { FlagSuspiciousTool } from './flag-suspicious-tool';
import type { MidiEvent } from '../pipeline/types';

function note(id: string, startMs: number, durationMs: number): MidiEvent {
  return { id, pitch: 60, startMs, durationMs, velocity: 80 };
}

describe('FlagSuspiciousTool', () => {
  it('flags notes shorter than 50ms', () => {
    const notes = [note('short', 0, 30), note('ok', 500, 500)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues).toHaveLength(1);
    expect(issues[0].noteId).toBe('short');
    expect(issues[0].type).toBe('short_note');
  });

  it('assigns high severity for notes under 20ms', () => {
    const notes = [note('tiny', 0, 10)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues[0].severity).toBe('high');
  });

  it('assigns medium severity for notes 20–49ms', () => {
    const notes = [note('mid', 0, 40)];
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues[0].severity).toBe('medium');
  });

  it('flags rhythmic outliers with z-score > 2.5', () => {
    // 7 regular notes at 500ms then one huge gap
    const notes = Array.from({ length: 7 }, (_, i) => note(`n${i}`, i * 500, 400));
    notes.push(note('outlier', 7 * 500 + 3000, 400)); // 3000ms gap — outlier
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    const outliers = issues.filter((i: { type: string }) => i.type === 'rhythmic_outlier');
    expect(outliers.length).toBeGreaterThan(0);
  });

  it('returns empty array for clean notes', () => {
    const notes = Array.from({ length: 4 }, (_, i) => note(`n${i}`, i * 500, 400));
    const tool = new FlagSuspiciousTool(notes);
    const issues = JSON.parse(tool.execute({}) as string);
    expect(issues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/tools/flag-suspicious-tool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement FlagSuspiciousTool**

```typescript
// src/tools/flag-suspicious-tool.ts
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, Issue } from '../pipeline/types';

function flagShortNotes(notes: MidiEvent[]): Issue[] {
  return notes
    .filter(n => n.durationMs < 50)
    .map(n => ({
      noteId: n.id,
      type: 'short_note' as const,
      description: `Note duration ${Math.round(n.durationMs)}ms is below 50ms threshold`,
      severity: n.durationMs < 20 ? ('high' as const) : ('medium' as const),
    }));
}

function flagRhythmicOutliers(notes: MidiEvent[]): Issue[] {
  if (notes.length < 3) return [];
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs);
  const iois = sorted.slice(1).map((n, i) => n.startMs - sorted[i]!.startMs).filter(v => v > 50);
  if (iois.length < 2) return [];

  const mean = iois.reduce((s, v) => s + v, 0) / iois.length;
  const std = Math.sqrt(iois.reduce((s, v) => s + (v - mean) ** 2, 0) / iois.length);
  if (std === 0) return [];

  const issues: Issue[] = [];
  sorted.slice(1).forEach((note, i) => {
    const ioi = note.startMs - sorted[i]!.startMs;
    if (ioi <= 50) return;
    const z = Math.abs(ioi - mean) / std;
    if (z > 2.5) {
      issues.push({
        noteId: note.id,
        type: 'rhythmic_outlier',
        description: `Onset gap of ${Math.round(ioi)}ms is ${z.toFixed(1)} std devs from median`,
        severity: z > 4 ? 'high' : 'medium',
      });
    }
  });
  return issues;
}

export class FlagSuspiciousTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('flag_suspicious', 'Flag short notes and rhythmic outliers in the MIDI events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  execute(_params: Record<string, unknown>): string {
    return JSON.stringify([
      ...flagShortNotes(this.notes),
      ...flagRhythmicOutliers(this.notes),
    ]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test src/tools/flag-suspicious-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/flag-suspicious-tool.ts src/tools/flag-suspicious-tool.test.ts
git commit -m "feat: add FlagSuspiciousTool for short notes and rhythmic outliers"
```

---

## Task 7: ApplyOperationsTool

**Files:**
- Create: `src/tools/apply-operations-tool.ts`
- Create: `src/tools/apply-operations-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/apply-operations-tool.test.ts
import { describe, it, expect } from 'vitest';
import { ApplyOperationsTool } from './apply-operations-tool';
import type { MidiEvent, EditOperation } from '../pipeline/types';

const baseNotes: MidiEvent[] = [
  { id: 'n1', pitch: 60, startMs: 0, durationMs: 500, velocity: 80 },
  { id: 'n2', pitch: 62, startMs: 500, durationMs: 500, velocity: 80 },
  { id: 'n3', pitch: 64, startMs: 1000, durationMs: 500, velocity: 80 },
];

describe('ApplyOperationsTool', () => {
  it('deletes notes with type "delete"', () => {
    const ops: EditOperation[] = [{ type: 'delete', noteId: 'n2' }];
    const tool = new ApplyOperationsTool(baseNotes);
    const result: MidiEvent[] = JSON.parse(tool.execute({ operations: ops }) as string);
    expect(result.map(n => n.id)).toEqual(['n1', 'n3']);
  });

  it('respells a note pitch', () => {
    const ops: EditOperation[] = [{ type: 'respell', noteId: 'n1', newPitch: 61 }];
    const tool = new ApplyOperationsTool(baseNotes);
    const result: MidiEvent[] = JSON.parse(tool.execute({ operations: ops }) as string);
    expect(result.find(n => n.id === 'n1')!.pitch).toBe(61);
  });

  it('requantizes a note duration', () => {
    const ops: EditOperation[] = [{ type: 'requantize', noteId: 'n3', newDurationMs: 250 }];
    const tool = new ApplyOperationsTool(baseNotes);
    const result: MidiEvent[] = JSON.parse(tool.execute({ operations: ops }) as string);
    expect(result.find(n => n.id === 'n3')!.durationMs).toBe(250);
  });

  it('keeps notes with type "keep" unchanged', () => {
    const ops: EditOperation[] = [{ type: 'keep', noteId: 'n2' }];
    const tool = new ApplyOperationsTool(baseNotes);
    const result: MidiEvent[] = JSON.parse(tool.execute({ operations: ops }) as string);
    expect(result).toHaveLength(3);
    expect(result.find(n => n.id === 'n2')!.pitch).toBe(62);
  });

  it('passes through notes with no operation', () => {
    const tool = new ApplyOperationsTool(baseNotes);
    const result: MidiEvent[] = JSON.parse(tool.execute({ operations: [] }) as string);
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/tools/apply-operations-tool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement ApplyOperationsTool**

```typescript
// src/tools/apply-operations-tool.ts
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, EditOperation } from '../pipeline/types';

export class ApplyOperationsTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('apply_operations', 'Apply a list of edit operations (keep/delete/respell/requantize) to the MIDI events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of EditOperation objects',
          items: { type: 'object' },
        },
      },
      required: ['operations'],
    };
  }

  execute(params: Record<string, unknown>): string {
    const operations = (params['operations'] ?? []) as EditOperation[];
    const opMap = new Map(operations.map(op => [op.noteId, op]));

    const result = this.notes
      .filter(note => {
        const op = opMap.get(note.id);
        return !op || op.type !== 'delete';
      })
      .map(note => {
        const op = opMap.get(note.id);
        if (!op || op.type === 'keep') return note;
        if (op.type === 'respell' && op.newPitch !== undefined) {
          return { ...note, pitch: op.newPitch };
        }
        if (op.type === 'requantize' && op.newDurationMs !== undefined) {
          return { ...note, durationMs: op.newDurationMs };
        }
        return note;
      });

    return JSON.stringify(result);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test src/tools/apply-operations-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/apply-operations-tool.ts src/tools/apply-operations-tool.test.ts
git commit -m "feat: add ApplyOperationsTool"
```

---

## Task 8: RenderTool

**Files:**
- Create: `src/tools/render-tool.ts`

- [ ] **Step 1: Implement RenderTool**

```typescript
// src/tools/render-tool.ts
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Midi } from '@tonejs/midi';
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, RendererResult } from '../pipeline/types';

const MSCORE = process.env['MSCORE_PATH'] ?? 'mscore';

function notesToMidiBuffer(notes: MidiEvent[]): Buffer {
  const midi = new Midi();
  const track = midi.addTrack();
  for (const note of notes) {
    track.addNote({
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
    proc.on('error', reject);
  });
}

export class RenderTool extends BaseTool {
  private notes: MidiEvent[];
  private outputDir: string;

  constructor(notes: MidiEvent[], outputDir: string) {
    super('render_midi', 'Convert MIDI events to MusicXML and PDF using MuseScore');
    this.notes = notes;
    this.outputDir = outputDir;
  }

  get parameters(): ToolParameters {
    return { type: 'object', properties: {}, required: [] };
  }

  async execute(_params: Record<string, unknown>): Promise<string> {
    const midiPath = join(this.outputDir, 'output.mid');
    const xmlPath = join(this.outputDir, 'output.musicxml');
    const pdfPath = join(this.outputDir, 'output.pdf');

    await writeFile(midiPath, notesToMidiBuffer(this.notes));
    await spawnAndWait(MSCORE, ['-o', xmlPath, midiPath]);
    await spawnAndWait(MSCORE, ['-o', pdfPath, midiPath]);

    const result: RendererResult = { musicxmlPath: xmlPath, pdfPath };
    return JSON.stringify(result);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
yarn tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/tools/render-tool.ts
git commit -m "feat: add RenderTool using @tonejs/midi and MuseScore CLI"
```

---

## Task 9: Five agents

**Files:**
- Create: `src/agents/transcription-agent.ts`
- Create: `src/agents/analysis-agent.ts`
- Create: `src/agents/cleanup-agent.ts`
- Create: `src/agents/editor-agent.ts`
- Create: `src/agents/renderer-agent.ts`

Each file exports a factory function that creates a fresh `OpenAIAgent` instance (fresh context per pipeline run).

- [ ] **Step 1: Create transcription-agent.ts**

```typescript
// src/agents/transcription-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { TranscribeTool } from '../tools/transcribe-tool';

const INSTRUCTIONS = `You are a transcription agent in a piano sheet music pipeline.
Use the transcribe_audio tool with the audio file path provided in the task.
After receiving the result, return it as a JSON object with exactly this structure:
{"midi": [...], "confidences": [...]}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createTranscriptionAgent(pythonServiceUrl: string): OpenAIAgent {
  return new OpenAIAgent('TranscriptionAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new TranscribeTool(pythonServiceUrl)],
  });
}
```

- [ ] **Step 2: Create analysis-agent.ts**

```typescript
// src/agents/analysis-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { ExtractFeaturesTool } from '../tools/extract-features-tool';
import { FlagSuspiciousTool } from '../tools/flag-suspicious-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a music analysis agent in a piano transcription pipeline.
You have two tools: extract_features and flag_suspicious.
Call both tools on the provided MIDI data.
Synthesise the results and return a JSON object:
{"features": {"temposBpm": [...], "key": "...", "timeSignature": "..."}, "issues": [...]}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createAnalysisAgent(notes: MidiEvent[]): OpenAIAgent {
  return new OpenAIAgent('AnalysisAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new ExtractFeaturesTool(notes), new FlagSuspiciousTool(notes)],
  });
}
```

- [ ] **Step 3: Create cleanup-agent.ts**

```typescript
// src/agents/cleanup-agent.ts
import { OpenAIAgent } from '../openai-agent';

const INSTRUCTIONS = `You are a music cleanup agent for jazz piano transcriptions.
You will receive MIDI events, a list of flagged issues, and optionally chord changes.
For each flagged issue decide what to do:
  - "keep": leave the note (default for jazz ornaments, passing tones, grace notes)
  - "delete": remove it (only for clear transcription artifacts)
  - "respell": change the MIDI pitch to its enharmonic equivalent (include newPitch)
  - "requantize": adjust the duration (include newDurationMs)
Jazz piano uses many non-chord tones — be conservative. Only delete when you are confident.
Return a JSON object:
{"operations": [{"type": "...", "noteId": "...", "newPitch": 61, "newDurationMs": 100}]}
Only include operations for notes that need action. Notes not listed are kept as-is.
Return only the JSON object — no prose, no markdown code blocks.`;

export function createCleanupAgent(): OpenAIAgent {
  return new OpenAIAgent('CleanupAgent', INSTRUCTIONS, {
    model: 'gpt-4o',
  });
}
```

- [ ] **Step 4: Create editor-agent.ts**

```typescript
// src/agents/editor-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { ApplyOperationsTool } from '../tools/apply-operations-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a MIDI editor agent. You receive a list of edit operations.
Use the apply_operations tool, passing the operations array.
Return the result as a JSON object:
{"midi": [...]}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createEditorAgent(notes: MidiEvent[]): OpenAIAgent {
  return new OpenAIAgent('EditorAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new ApplyOperationsTool(notes)],
  });
}
```

- [ ] **Step 5: Create renderer-agent.ts**

```typescript
// src/agents/renderer-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { RenderTool } from '../tools/render-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a rendering agent in a piano transcription pipeline.
Use the render_midi tool to convert the MIDI events into MusicXML and PDF files.
Return a JSON object:
{"musicxmlPath": "...", "pdfPath": "..."}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createRendererAgent(notes: MidiEvent[], outputDir: string): OpenAIAgent {
  return new OpenAIAgent('RendererAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new RenderTool(notes, outputDir)],
  });
}
```

- [ ] **Step 6: Type-check**

```bash
yarn tsc --noEmit
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/agents/
git commit -m "feat: add five OpenAIAgent factories"
```

---

## Task 10: JobStore

**Files:**
- Create: `src/server/job-store.ts`
- Create: `src/server/job-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/job-store.test.ts
import { describe, it, expect, vi } from 'vitest';
import { JobStore } from './job-store';

describe('JobStore', () => {
  it('creates a job with pending status', () => {
    const store = new JobStore();
    store.create('job1', { audioPath: '/tmp/audio.wav' });
    const job = store.get('job1')!;
    expect(job.status).toBe('pending');
    expect(job.audioPath).toBe('/tmp/audio.wav');
    expect(job.events).toHaveLength(0);
  });

  it('addEvent transitions status to running and notifies subscribers', () => {
    const store = new JobStore();
    store.create('job1', { audioPath: '/tmp/audio.wav' });
    const cb = vi.fn();
    store.subscribe('job1', cb);
    store.addEvent('job1', { type: 'stage_start', stage: 'transcription' });
    expect(store.get('job1')!.status).toBe('running');
    expect(cb).toHaveBeenCalledWith({ type: 'stage_start', stage: 'transcription' });
  });

  it('complete sets status and result', () => {
    const store = new JobStore();
    store.create('job1', { audioPath: '/tmp/audio.wav' });
    const result = { musicxmlPath: '/tmp/out.xml', pdfPath: '/tmp/out.pdf' };
    store.complete('job1', result);
    const job = store.get('job1')!;
    expect(job.status).toBe('complete');
    expect(job.result).toEqual(result);
  });

  it('fail sets status and error', () => {
    const store = new JobStore();
    store.create('job1', { audioPath: '/tmp/audio.wav' });
    store.fail('job1', 'something broke');
    expect(store.get('job1')!.status).toBe('failed');
    expect(store.get('job1')!.error).toBe('something broke');
  });

  it('unsubscribe stops receiving events', () => {
    const store = new JobStore();
    store.create('job1', { audioPath: '/tmp/audio.wav' });
    const cb = vi.fn();
    const unsub = store.subscribe('job1', cb);
    unsub();
    store.addEvent('job1', { type: 'stage_start', stage: 'analysis' });
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/server/job-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement JobStore**

```typescript
// src/server/job-store.ts
import type { JobState, JobStatus, PipelineEvent, RendererResult } from '../pipeline/types';

type Subscriber = (event: PipelineEvent) => void;

export class JobStore {
  private jobs = new Map<string, JobState>();
  private subscribers = new Map<string, Set<Subscriber>>();

  create(id: string, input: { audioPath: string; chordChanges?: string }): JobState {
    const job: JobState = {
      id,
      status: 'pending',
      audioPath: input.audioPath,
      chordChanges: input.chordChanges,
      createdAt: new Date(),
      events: [],
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id);
  }

  addEvent(id: string, event: PipelineEvent): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(event);
    job.status = 'running';
    this.notify(id, event);
  }

  complete(id: string, result: RendererResult): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'complete';
    job.result = result;
    const event: PipelineEvent = { type: 'pipeline_complete', result };
    job.events.push(event);
    this.notify(id, event);
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    const event: PipelineEvent = { type: 'stage_error', error };
    job.events.push(event);
    this.notify(id, event);
  }

  subscribe(id: string, cb: Subscriber): () => void {
    if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
    this.subscribers.get(id)!.add(cb);
    return () => this.subscribers.get(id)?.delete(cb);
  }

  private notify(id: string, event: PipelineEvent): void {
    const subs = this.subscribers.get(id);
    if (subs) for (const sub of subs) sub(event);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test src/server/job-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/job-store.ts src/server/job-store.test.ts
git commit -m "feat: add JobStore with SSE subscriber support"
```

---

## Task 11: Pipeline runner

**Files:**
- Create: `src/pipeline/run-pipeline.ts`

- [ ] **Step 1: Implement run-pipeline.ts**

```typescript
// src/pipeline/run-pipeline.ts
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { AgentResponse } from '../types';
import type {
  AudioInput,
  TranscriptionResult,
  AnalysisResult,
  CleanupResult,
  EditorResult,
  RendererResult,
  PipelineEvent,
  PipelineStage,
} from './types';
import { createTranscriptionAgent } from '../agents/transcription-agent';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCleanupAgent } from '../agents/cleanup-agent';
import { createEditorAgent } from '../agents/editor-agent';
import { createRendererAgent } from '../agents/renderer-agent';

export interface PipelineConfig {
  pythonServiceUrl: string;
  jobOutputDir: string;
}

function parseOutput<T>(response: AgentResponse): T {
  const last = [...response.messages].reverse().find(m => m.role === 'assistant');
  if (!last) throw new Error('Agent produced no output');
  const cleaned = last.content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function runPipeline(
  input: AudioInput,
  config: PipelineConfig,
  emit: (event: PipelineEvent) => void,
): Promise<RendererResult> {
  const { pythonServiceUrl, jobOutputDir } = config;
  await mkdir(jobOutputDir, { recursive: true });

  const go = (stage: PipelineStage) => emit({ type: 'stage_start', stage });
  const done = (stage: PipelineStage) => emit({ type: 'stage_complete', stage });

  // Stage 1: Transcription
  go('transcription');
  const transcriptionAgent = createTranscriptionAgent(pythonServiceUrl);
  const transcriptionResponse = await transcriptionAgent.run(
    `Transcribe the audio file at path: ${input.audioPath}. Use the transcribe_audio tool, then return the result as JSON.`,
  );
  const transcription = parseOutput<TranscriptionResult>(transcriptionResponse);
  done('transcription');

  // Stage 2: Analysis
  go('analysis');
  const analysisAgent = createAnalysisAgent(transcription.midi);
  const analysisResponse = await analysisAgent.run(
    `Analyse the MIDI transcription. Use both the extract_features and flag_suspicious tools, then return the combined result as JSON.`,
  );
  const analysis = parseOutput<AnalysisResult>(analysisResponse);
  done('analysis');

  // Stage 3: Cleanup
  go('cleanup');
  const cleanupAgent = createCleanupAgent();
  const cleanupTask = [
    `Review this jazz piano transcription for cleanup.`,
    `\nMIDI events (${transcription.midi.length} notes):\n${JSON.stringify(transcription.midi)}`,
    `\nDetected issues:\n${JSON.stringify(analysis.issues)}`,
    input.chordChanges ? `\nChord changes:\n${input.chordChanges}` : '',
    `\nReturn the operations JSON.`,
  ].join('');
  const cleanupResponse = await cleanupAgent.run(cleanupTask);
  const cleanup = parseOutput<CleanupResult>(cleanupResponse);
  done('cleanup');

  // Stage 4: Editor
  go('editor');
  const editorAgent = createEditorAgent(transcription.midi);
  const editorResponse = await editorAgent.run(
    `Apply these operations to the MIDI:\n${JSON.stringify(cleanup.operations)}\nUse the apply_operations tool and return the result as JSON.`,
  );
  const editor = parseOutput<EditorResult>(editorResponse);
  done('editor');

  // Stage 5: Renderer
  go('renderer');
  const outputDir = join(jobOutputDir);
  const rendererAgent = createRendererAgent(editor.midi, outputDir);
  const rendererResponse = await rendererAgent.run(
    `Render the MIDI events to MusicXML and PDF. Use the render_midi tool and return the file paths as JSON.`,
  );
  const renderer = parseOutput<RendererResult>(rendererResponse);
  done('renderer');

  emit({ type: 'pipeline_complete', result: renderer });
  return renderer;
}
```

- [ ] **Step 2: Type-check**

```bash
yarn tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/run-pipeline.ts
git commit -m "feat: add sequential pipeline runner"
```

---

## Task 12: Express server

**Files:**
- Create: `src/server/server.ts`

- [ ] **Step 1: Implement server.ts**

```typescript
// src/server/server.ts
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { JobStore } from './job-store';
import { runPipeline } from '../pipeline/run-pipeline';

const PYTHON_URL = process.env['PYTHON_SERVICE_URL'] ?? 'http://localhost:8000';
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const JOBS_DIR = path.resolve('tmp/jobs');

const app = express();
const upload = multer({ dest: 'tmp/uploads/' });
const store = new JobStore();

app.use(express.json());
app.use('/tmp', express.static('tmp'));

app.post('/api/jobs', upload.single('audio'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'audio file required' }); return; }
  const jobId = randomUUID();
  const audioPath = path.resolve(req.file.path);
  const chordChanges = typeof req.body['chords'] === 'string' ? req.body['chords'] : undefined;
  const jobOutputDir = path.join(JOBS_DIR, jobId);

  store.create(jobId, { audioPath, chordChanges });

  runPipeline(
    { audioPath, chordChanges },
    { pythonServiceUrl: PYTHON_URL, jobOutputDir },
    event => store.addEvent(jobId, event),
  )
    .then(result => {
      // Convert absolute paths to URL paths served by the /tmp static route
      const toUrl = (p: string) => '/' + path.relative(process.cwd(), p).replace(/\\/g, '/');
      store.complete(jobId, {
        musicxmlPath: toUrl(result.musicxmlPath),
        pdfPath: toUrl(result.pdfPath),
      });
    })
    .catch((err: unknown) => store.fail(jobId, err instanceof Error ? err.message : String(err)));

  res.json({ jobId });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = store.get(req.params['id']!);
  if (!job) { res.status(404).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.status === 'complete' || job.status === 'failed') {
    res.end();
    return;
  }

  const unsub = store.subscribe(req.params['id']!, event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'pipeline_complete' || event.type === 'stage_error') {
      res.end();
      unsub();
    }
  });

  req.on('close', unsub);
});

app.get('/api/jobs/:id/result', (req, res) => {
  const job = store.get(req.params['id']!);
  if (!job || job.status !== 'complete') {
    res.status(404).json({ error: 'result not ready' });
    return;
  }
  res.json(job.result);
});

app.listen(PORT, () => console.log(`Server running on :${PORT}`));

export { app };
```

- [ ] **Step 2: Type-check**

```bash
yarn tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/server/server.ts
git commit -m "feat: add Express server with job management and SSE"
```

---

## Task 13: Frontend components

**Files:**
- Create: `src/ui/main.tsx`
- Create: `src/ui/App.tsx`
- Create: `src/ui/components/UploadForm.tsx`
- Create: `src/ui/components/PipelineProgress.tsx`
- Create: `src/ui/components/DownloadPanel.tsx`

- [ ] **Step 1: Create main.tsx**

```tsx
// src/ui/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Create index.css** (Tailwind entry)

```css
/* src/ui/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Create UploadForm.tsx**

```tsx
// src/ui/components/UploadForm.tsx
import { useState, useRef } from 'react';

interface Props {
  onJobCreated: (jobId: string) => void;
}

export function UploadForm({ onJobCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chordsRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Please select an audio file'); return; }

    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append('audio', file);
    const chords = chordsRef.current?.value.trim();
    if (chords) form.append('chords', chords);

    try {
      const res = await fetch('/api/jobs', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
          ref={fileRef}
          type="file"
          accept=".wav,.m4a,audio/wav,audio/x-m4a"
          className="block w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Chord changes (optional)</label>
        <textarea
          ref={chordsRef}
          rows={3}
          placeholder="e.g. Cmaj7 | Am7 | Dm7 | G7"
          className="w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900 font-mono resize-none"
        />
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

- [ ] **Step 4: Create DownloadPanel.tsx**

```tsx
// src/ui/components/DownloadPanel.tsx
interface Props {
  musicxmlPath: string;
  pdfPath: string;
}

export function DownloadPanel({ musicxmlPath, pdfPath }: Props) {
  return (
    <div className="flex gap-4 mt-6">
      <a
        href={`/${musicxmlPath}`}
        download
        className="flex-1 text-center py-2 rounded border border-zinc-600 hover:bg-zinc-800"
      >
        Download MusicXML
      </a>
      <a
        href={`/${pdfPath}`}
        download
        className="flex-1 text-center py-2 rounded bg-blue-600 hover:bg-blue-500"
      >
        Download PDF
      </a>
    </div>
  );
}
```

- [ ] **Step 5: Create PipelineProgress.tsx**

```tsx
// src/ui/components/PipelineProgress.tsx
import { useEffect, useState } from 'react';
import { DownloadPanel } from './DownloadPanel';
import type { PipelineStage, PipelineEvent, RendererResult } from '../../pipeline/types';

type StageStatus = 'pending' | 'running' | 'complete' | 'error';

const STAGES: PipelineStage[] = ['transcription', 'analysis', 'cleanup', 'editor', 'renderer'];
const LABELS: Record<PipelineStage, string> = {
  transcription: 'Transcription',
  analysis: 'Analysis',
  cleanup: 'Cleanup',
  editor: 'Editor',
  renderer: 'Renderer',
};

interface Props {
  jobId: string;
  onReset: () => void;
}

export function PipelineProgress({ jobId, onReset }: Props) {
  const [stages, setStages] = useState<Record<PipelineStage, StageStatus>>({
    transcription: 'pending', analysis: 'pending', cleanup: 'pending',
    editor: 'pending', renderer: 'pending',
  });
  const [result, setResult] = useState<RendererResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as PipelineEvent;
      if (event.type === 'stage_start' && event.stage) {
        setStages(s => ({ ...s, [event.stage!]: 'running' }));
      } else if (event.type === 'stage_complete' && event.stage) {
        setStages(s => ({ ...s, [event.stage!]: 'complete' }));
      } else if (event.type === 'stage_error') {
        setError(event.error ?? 'Pipeline failed');
        es.close();
      } else if (event.type === 'pipeline_complete' && event.result) {
        setResult(event.result);
        es.close();
      }
    };

    es.onerror = () => { setError('Connection lost'); es.close(); };
    return () => es.close();
  }, [jobId]);

  const icon = (status: StageStatus) => {
    if (status === 'complete') return '✓';
    if (status === 'running') return '⟳';
    if (status === 'error') return '✗';
    return '○';
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-lg font-semibold">Transcribing…</h2>
      <ul className="space-y-2">
        {STAGES.map(stage => (
          <li key={stage} className="flex items-center gap-3">
            <span className={`text-lg w-6 ${stages[stage] === 'complete' ? 'text-green-400' : stages[stage] === 'running' ? 'text-yellow-400 animate-spin' : stages[stage] === 'error' ? 'text-red-400' : 'text-zinc-600'}`}>
              {icon(stages[stage])}
            </span>
            <span className={stages[stage] === 'pending' ? 'text-zinc-500' : ''}>{LABELS[stage]}</span>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {result && <DownloadPanel musicxmlPath={result.musicxmlPath} pdfPath={result.pdfPath} />}
      {(result || error) && (
        <button onClick={onReset} className="text-sm text-zinc-400 hover:text-white underline mt-4">
          Transcribe another file
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create App.tsx**

```tsx
// src/ui/App.tsx
import { useState } from 'react';
import { UploadForm } from './components/UploadForm';
import { PipelineProgress } from './components/PipelineProgress';

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-8">Piano Transcriber</h1>
      {jobId
        ? <PipelineProgress jobId={jobId} onReset={() => setJobId(null)} />
        : <UploadForm onJobCreated={setJobId} />
      }
    </div>
  );
}
```

- [ ] **Step 7: Type-check frontend**

```bash
yarn tsc --noEmit
```

Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/ui/
git commit -m "feat: add React upload form and pipeline progress UI"
```

---

## Task 14: Dev wiring

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Update vite.config.ts to proxy /api to Express**

Replace the empty `proxy: {}` in `vite.config.ts`:

```typescript
// vite.config.ts  (full file — replace existing)
/// <reference types="vite/client" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src/ui") },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/tmp": "http://localhost:3001",
    },
  },
});
```

- [ ] **Step 2: Add dev scripts to package.json**

In the `"scripts"` section of `package.json`, add:

```json
"dev": "concurrently \"yarn dev:client\" \"yarn dev:server\"",
"dev:client": "vite",
"dev:server": "ts-node --esm src/server/server.ts",
```

- [ ] **Step 3: Create .env.example**

```bash
# .env.example
OPENAI_API_KEY=sk-...
PYTHON_SERVICE_URL=http://localhost:8000
PORT=3001
MSCORE_PATH=mscore
```

Copy to `.env` and fill in values:

```bash
cp .env.example .env
```

- [ ] **Step 4: Run the full stack**

Terminal 1 — Python service:
```bash
cd python && uvicorn main:app --port 8000 --reload
```

Terminal 2 — TS dev:
```bash
yarn dev
```

Open `http://localhost:5173`. Upload a WAV file, verify:
- Upload succeeds (network tab shows `POST /api/jobs` returning `{ jobId }`)
- SSE stream opens (`GET /api/jobs/:id/events` in network tab)
- Progress steps animate through pending → running → complete
- After renderer stage: PDF and MusicXML download links appear

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json .env.example
git commit -m "chore: add dev scripts and proxy config"
```

---

## Running all tests

```bash
yarn test
```

Expected: all unit tests pass (job-store, tools). Pipeline and agent tests require live services — run those manually.
