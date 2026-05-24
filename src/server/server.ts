// src/server/server.ts
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "path";
import { JobStore } from "./job-store";
import { runPipeline } from "../pipeline/run-pipeline";
import type { ChordEvent } from "../pipeline/types";

config({ path: path.join(__dirname, "../../.env") });

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

if (process.env["OPENAI_API_KEY"] === undefined) {
  console.warn("Warning: OPENAI_API_KEY is not set. The pipeline will not work without it.");
  process.exit(1);
}

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const JOBS_DIR = path.resolve("tmp/jobs");

const app = express();
const upload = multer({
  dest: "tmp/uploads/",
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'midi') {
      cb(null, true);
    } else if (file.fieldname === 'audio') {
      cb(null, /wav|m4a|audio/.test(file.mimetype));
    } else {
      cb(null, true);
    }
  },
});
const store = new JobStore();

app.use(express.json());
app.use("/tmp", express.static("tmp"));

app.use((req, _res, next) => {
  const start = Date.now();
  _res.on("finish", () => {
    console.log(`${C.gray}[http] ${req.method} ${req.path} ${_res.statusCode} (${Date.now() - start}ms)${C.reset}`);
  });
  next();
});

app.post(
  "/api/jobs",
  upload.any(),
  (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    const midiFile = files.find(f => f.fieldname === 'midi');
    const audioFile = files.find(f => f.fieldname === 'audio');

    // Save files to test-input directory for debugging
    const testInputDir = path.resolve("test-input");
    if (midiFile) {
      const fs = require("fs");
      fs.mkdirSync(testInputDir, { recursive: true });
      fs.copyFileSync(midiFile.path, path.join(testInputDir, midiFile.originalname));
      console.log(`${C.gray}[debug] saved midi file to ${path.join(testInputDir, midiFile.originalname)}${C.reset}`);
    }
    if (audioFile) {
      const fs = require("fs");
      fs.mkdirSync(testInputDir, { recursive: true });
      fs.copyFileSync(audioFile.path, path.join(testInputDir, audioFile.originalname));
      console.log(`${C.gray}[debug] saved audio file to ${path.join(testInputDir, audioFile.originalname)}${C.reset}`);
    }

    if (!midiFile && audioFile) {
      res.status(400).json({ error: "Audio upload is no longer supported. Use MIDI recording." });
      return;
    }
    if (!midiFile) {
      res.status(400).json({ error: "midi file required" });
      return;
    }

    let chords: ChordEvent[] = [];
    const rawChords = req.body?.chordsJson as string | undefined;
    if (rawChords) {
      try {
        chords = JSON.parse(rawChords) as ChordEvent[];
      } catch {
        res.status(400).json({ error: "chordsJson must be a JSON-encoded ChordEvent array" });
        return;
      }
    }

    const jobId = randomUUID();
    const midiPath = path.resolve(midiFile.path);
    const jobOutputDir = path.join(JOBS_DIR, jobId);

    store.create(jobId, { midiPath, chords });
    console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} created file=${midiFile.originalname}`);

    const stageStart: Record<string, number> = {};

    runPipeline(
      { midiPath, chords },
      { jobOutputDir },
      (event) => {
        store.addEvent(jobId, event);
        if (event.type === "stage_start" && event.stage) {
          stageStart[event.stage] = Date.now();
          console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.yellow}▶ ${event.stage}${C.reset}`);
        } else if (event.type === "stage_complete" && event.stage) {
          const elapsed = ((Date.now() - (stageStart[event.stage] ?? Date.now())) / 1000).toFixed(2);
          console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.green}✓ ${event.stage}${C.reset}${C.dim} (${elapsed}s)${C.reset}`);
        } else if (event.type === "stage_error") {
          console.error(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.red}✗ stage_error: ${event.error}${C.reset}`);
        }
      },
    )
      .then((result) => {
        const toUrl = (p: string) =>
          "/" + path.relative(process.cwd(), p).replace(/\\/g, "/");
        store.complete(jobId, {
          musicxmlPath: toUrl(result.musicxmlPath),
          pdfPath: toUrl(result.pdfPath),
          feedbackResult: result.feedbackResult,
        });
        console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.green}${C.bold}complete${C.reset}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        store.fail(jobId, message);
        console.error(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.red}${C.bold}failed:${C.reset}${C.red} ${message}${C.reset}`);
      });

    res.json({ jobId });
  },
);

app.get("/api/jobs/:id/events", (req, res) => {
  const job = store.get(req.params["id"]!);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.status === "complete" || job.status === "failed") {
    res.end();
    return;
  }

  const unsub = store.subscribe(req.params["id"]!, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "pipeline_complete") {
      res.end();
      unsub();
    } else if (event.type === "stage_error" && !event.stage) {
      // Fatal pipeline error (no stage = top-level failure)
      res.end();
      unsub();
    }
  });

  req.on("close", unsub);
});

app.get("/api/jobs/:id/result", (req, res) => {
  const job = store.get(req.params["id"]!);
  if (!job || job.status !== "complete") {
    res.status(404).json({ error: "result not ready" });
    return;
  }
  res.json(job.result);
});

app.listen(PORT, () => console.log(`Server running on :${PORT}`));

export { app };
