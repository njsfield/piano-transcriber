# Piano Transcriber — Design Spec

**Date:** 2026-05-22
**Status:** Approved

---

## Overview

A web application that accepts a recorded WAV or M4A audio file (primarily jazz piano), runs it through a five-agent transcription pipeline, and returns downloadable MusicXML and PDF sheet music. The pipeline is orchestrated server-side; the browser uploads the file and streams live progress via SSE while each stage completes.

---

## System Shape

Three runtimes:

- **React (Vite + Tailwind)** — upload form, SSE progress display, download links
- **Express (TypeScript)** — job management, pipeline orchestration, SSE
- **FastAPI (Python)** — basic-pitch transcription only

```
Browser
  POST /api/jobs  (multipart: audio file + optional chord changes text)
  GET  /api/jobs/:id/events  (SSE stream)
  GET  /api/jobs/:id/result  (download URLs)

Express Pipeline (sequential, all TypeScript):
  TranscriptionAgent → AnalysisAgent → CleanupAgent → EditorAgent → RendererAgent

TranscriptionAgent → HTTP → FastAPI /transcribe → basic-pitch
AnalysisAgent      → TypeScript MIDI parsing (@tonejs/midi)
CleanupAgent       → GPT-4o reasoning, no tools
EditorAgent        → TypeScript MIDI manipulation (@tonejs/midi)
RendererAgent      → child_process.spawn → MuseScore CLI
```

---

## Shared Types

All inter-agent data is typed. The pipeline is a typed hand-off chain:

```typescript
AudioInput           { audioPath: string; chordChanges?: string }
TranscriptionResult  { midi: MidiEvent[]; confidences: NoteConfidence[] }
AnalysisResult       { features: MusicFeatures; issues: Issue[] }
CleanupResult        { operations: EditOperation[] }
EditorResult         { midi: MidiEvent[] }
RendererResult       { musicxmlPath: string; pdfPath: string }
```

Supporting types:

```typescript
MidiEvent        { pitch: number; startMs: number; durationMs: number; velocity: number; id: string }
NoteConfidence   { noteId: string; confidence: number }
MusicFeatures    { temposBpm: number[]; key: string; timeSignature: string }
Issue            { noteId: string; type: 'short_note' | 'rhythmic_outlier'; description: string; severity: 'low' | 'medium' | 'high' }
EditOperation    { type: 'keep' | 'delete' | 'respell' | 'requantize'; noteId: string; newPitch?: number; newDurationMs?: number }
```

No harmonic outlier detection — jazz piano makes heavy use of passing notes and non-chord tones, making harmonic flagging unreliable.

---

## The Five Agents

All agents are `OpenAIAgent` instances from the boilerplate (`src/openai-agent.ts`). Each has typed `BaseTool` subclasses as its only external interface. The LLM reasons and decides; tools execute.

### TranscriptionAgent

- **Model:** `gpt-4o-mini`
- **Tool:** `TranscribeTool` — POSTs audio file to Python `/transcribe`, receives `MidiEvent[]` + `NoteConfidence[]`
- **LLM role:** Validates tool output structure, surfaces any gaps, emits `TranscriptionResult` as JSON
- **Output contract:** `TranscriptionResult`

### AnalysisAgent

- **Model:** `gpt-4o-mini`
- **Tools:**
  - `ExtractFeaturesTool` — reads tempo/key/time-sig from MIDI event stream using `@tonejs/midi` (pure TypeScript, no Python)
  - `FlagSuspiciousTool` — identifies short notes (<50ms) and rhythmic outliers (statistical analysis of inter-onset intervals) using `@tonejs/midi`
- **LLM role:** Synthesises tool results, applies music context, produces final `AnalysisResult` with a curated issues list
- **Output contract:** `AnalysisResult`

### CleanupAgent

- **Model:** `gpt-4o` (most reasoning-intensive step)
- **Tools:** None — MIDI, issues list, and optional chord changes are provided in context
- **LLM role:** For each issue, reasons about musical intent (jazz context, passing notes, phrasing) and decides `keep`, `delete`, or `requantize`. Emits `CleanupResult` as structured JSON
- **Output contract:** `CleanupResult`
- **Note:** The LLM never produces MIDI. It produces a list of operations that describe what to do.

### EditorAgent

- **Model:** `gpt-4o-mini`
- **Tool:** `ApplyOperationsTool` — applies `EditOperation[]` to `MidiEvent[]` using `@tonejs/midi` in TypeScript. Returns modified `MidiEvent[]`
- **LLM role:** Reviews operations for consistency before calling the tool, then confirms what was applied
- **Output contract:** `EditorResult`

### RendererAgent

- **Model:** `gpt-4o-mini`
- **Tool:** `RenderTool` — writes MIDI to a temp file, calls MuseScore CLI via `child_process.spawn` to export MusicXML and PDF, returns file paths
- **LLM role:** Calls the tool, confirms output files exist, emits `RendererResult`
- **Output contract:** `RendererResult`

---

## Python FastAPI Service

Single endpoint. Stateless — every request is self-contained.

```
POST /transcribe
  Input:  multipart form — audio file (WAV or M4A)
  Output: { midi: MidiEvent[], confidences: NoteConfidence[] }
  Impl:   basic-pitch inference → MIDI note events + per-note confidence scores
```

All other pipeline steps are TypeScript or system-level CLI calls.

---

## Pipeline Orchestration

The pipeline is a sequential `async` function — not the boilerplate `WorkflowRunner` (which is synchronous and designed for fan-out/fan-in graph workflows, not a linear typed chain).

```typescript
async function runPipeline(jobId: string, input: AudioInput, emit: (event: PipelineEvent) => void): Promise<RendererResult>
```

Each agent step:
1. Emits a `stage_start` SSE event with stage name
2. Calls `agent.run(taskString)` where the task string contains the previous stage's JSON output
3. Parses the agent's final message content as the typed output
4. Emits a `stage_complete` SSE event
5. Passes output to the next stage

On any error, emits a `stage_error` event and throws — Express catches it and marks the job as failed.

---

## Express API

```
POST /api/jobs
  Body: multipart/form-data { audio: File, chords?: string }
  Response: { jobId: string }
  Action: saves audio to temp dir, creates JobState in memory, starts runPipeline async

GET /api/jobs/:id/events
  Response: text/event-stream (SSE)
  Events: stage_start | stage_complete | stage_error | pipeline_complete

GET /api/jobs/:id/result
  Response: { musicxmlUrl: string, pdfUrl: string }
  Only available when job status is complete
```

Job state is held in a `Map<string, JobState>` in Express memory — no database for MVP. Files are written to `tmp/jobs/:jobId/` and served as static files.

---

## Frontend

Single-page form:

- File input: WAV or M4A, validated client-side by MIME type
- Textarea: optional chord changes (e.g. `Cmaj7 | Am7 | Dm7 | G7`)
- On submit: `POST /api/jobs`, then open SSE stream
- Progress display: five labelled steps (Transcription → Analysis → Cleanup → Edit → Render), each showing pending / running / complete / error state
- On `pipeline_complete`: show download buttons for MusicXML and PDF

---

## Eval Surface

Each agent is independently eval-able using the existing `runEval` + `LLMJudge` + `renderReport` infrastructure from `src/eval-utils.ts`.

Pattern per agent:

```typescript
// Define scenarios with synthetic typed inputs
const scenarios: CleanupScenario[] = [...]

// Define judges scoped to that agent's concerns
class OperationSoundnessJudge extends LLMJudge { ... }

// Run eval
await runEval({
  agentName: 'CleanupAgent',
  scenarios,
  judges: [new OperationSoundnessJudge()],
  run: (s) => cleanupAgent.run(buildTaskString(s)),
  buildContext: (s) => JSON.stringify(s.input),
  outputDir: 'evals/output',
})
```

No eval code is written as part of this implementation — the agents are designed so evals can be added without modifying them (clean input/output contracts, no side effects in the agent itself).

---

## Dependencies to Add

```
@tonejs/midi       TypeScript MIDI parsing and manipulation
```

Job IDs use `node:crypto` `randomUUID()` — no extra package needed.

System dependency (not npm):
```
MuseScore CLI      mscore command must be available on PATH
```

Python dependencies (in separate `python/requirements.txt`):
```
basic-pitch
fastapi
uvicorn
python-multipart
```

---

## File Structure

```
src/
  agents/
    transcription-agent.ts    OpenAIAgent + TranscribeTool
    analysis-agent.ts         OpenAIAgent + ExtractFeaturesTool + FlagSuspiciousTool
    cleanup-agent.ts          OpenAIAgent (no tools)
    editor-agent.ts           OpenAIAgent + ApplyOperationsTool
    renderer-agent.ts         OpenAIAgent + RenderTool
  tools/
    transcribe-tool.ts
    extract-features-tool.ts
    flag-suspicious-tool.ts
    apply-operations-tool.ts
    render-tool.ts
  pipeline/
    types.ts                  All shared types (MidiEvent, Issue, EditOperation, etc.)
    run-pipeline.ts           Sequential async orchestrator
  server/
    server.ts                 Express app, routes, SSE
    job-store.ts              In-memory JobState map
  ui/
    App.tsx
    components/
      UploadForm.tsx
      PipelineProgress.tsx
      DownloadPanel.tsx
python/
  main.py                     FastAPI app
  requirements.txt
```
