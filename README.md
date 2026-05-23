# Piano Transcriber

A five-agent pipeline that accepts a WAV or M4A piano recording, transcribes it via [basic-pitch](https://github.com/spotify/basic-pitch), cleans it up with GPT reasoning, and delivers downloadable MusicXML + PDF sheet music through a React UI with live SSE progress.

## Architecture

Five `OpenAIAgent` instances run sequentially:

1. **TranscriptionAgent** — POSTs audio to the Python/basic-pitch service, receives MIDI events
2. **AnalysisAgent** — extracts tempo/key and flags suspicious notes (short notes, rhythmic outliers)
3. **CleanupAgent** — uses GPT-4o reasoning to decide keep/delete/respell/requantize for each flagged note
4. **EditorAgent** — applies the edit operations to the MIDI array
5. **RendererAgent** — converts MIDI to MusicXML and PDF via MuseScore CLI

The Express server manages jobs in memory, streams SSE progress events, and serves output files statically. A minimal Python FastAPI service handles the basic-pitch transcription step.

## Prerequisites

- **Node.js** 20+
- **Python** 3.9+
- **MuseScore 4** (CLI available as `mscore` or set `MSCORE_PATH`)
- An **OpenAI API key**

### Install MuseScore

- macOS: `brew install --cask musescore` (binary at `/Applications/MuseScore 4.app/Contents/MacOS/mscore`)
- Linux: `sudo apt install musescore4` or download from [musescore.org](https://musescore.org)

## Setup

### 1. Clone and install JS dependencies

```bash
git clone <repo>
cd piano-transcriber
yarn install
```

### 2. Set up the Python service

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...            # required
PYTHON_SERVICE_URL=http://localhost:8000   # default
PORT=3001                        # default
MSCORE_PATH=mscore               # or full path, e.g. /Applications/MuseScore\ 4.app/Contents/MacOS/mscore
```

## Running locally

You need three terminals:

**Terminal 1 — Python transcription service:**
```bash
cd python
source .venv/bin/activate
uvicorn main:app --port 8000 --reload
```

**Terminal 2 — TypeScript dev server + Vite:**
```bash
yarn dev
```

This runs `concurrently`:
- `vite` on `http://localhost:5173` (React UI)
- `ts-node src/server/server.ts` on `http://localhost:3001` (Express API)

**Open the app:** `http://localhost:5173`

## Usage

1. Upload a WAV or M4A piano recording
2. Optionally enter chord changes (e.g. `Cmaj7 | Am7 | Dm7 | G7`)
3. Watch the five pipeline stages animate through in the progress view
4. Download the MusicXML and PDF when complete

## Running tests

```bash
yarn test
```

All unit tests cover: `JobStore`, `TranscribeTool`, `ExtractFeaturesTool`, `FlagSuspiciousTool`, `ApplyOperationsTool` (23 tests, no external services required).

## Project structure

```
src/
  agents/           Five OpenAIAgent factory functions
  pipeline/
    types.ts        All shared pipeline types
    run-pipeline.ts Sequential pipeline orchestrator
  server/
    job-store.ts    In-memory job state + SSE subscriber map
    server.ts       Express routes, SSE, static file serving
  tools/            BaseTool subclasses (one per external concern)
  ui/               React 19 + Tailwind frontend
python/
  main.py           FastAPI + basic-pitch transcription endpoint
  requirements.txt
```

## Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Your OpenAI key. |
| `PYTHON_SERVICE_URL` | `http://localhost:8000` | URL of the Python transcription service |
| `PORT` | `3001` | Express server port |
| `MSCORE_PATH` | `mscore` | Path to MuseScore CLI binary |
