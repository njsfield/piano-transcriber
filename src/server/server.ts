// src/server/server.ts
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "path";
import { JobStore } from "./job-store";
import { runPipeline } from "../pipeline/run-pipeline";

config({ path: path.join(__dirname, "../../.env") });

if (process.env["OPENAI_API_KEY"] === undefined) {
  console.warn(
    "Warning: OPENAI_API_KEY is not set. The pipeline will not work without it.",
  );
  process.exit(1);
}

const PYTHON_URL = process.env["PYTHON_SERVICE_URL"] ?? "http://localhost:8000";
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const JOBS_DIR = path.resolve("tmp/jobs");

const app = express();
const upload = multer({
  dest: "tmp/uploads/",
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /wav|m4a|audio/.test(file.mimetype));
  },
});
const store = new JobStore();

app.use(express.json());
app.use("/tmp", express.static("tmp"));

app.use((req, _res, next) => {
  const start = Date.now();
  _res.on("finish", () => {
    console.log(`[http] ${req.method} ${req.path} ${_res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.post("/api/jobs", upload.single("audio"), (req, res) => {
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
  console.log(`[job:${jobId}] created file=${req.file.originalname}`);

  const stageStart: Record<string, number> = {};

  runPipeline(
    { audioPath, chordChanges },
    { pythonServiceUrl: PYTHON_URL, jobOutputDir },
    (event) => {
      store.addEvent(jobId, event);
      if (event.type === "stage_start" && event.stage) {
        stageStart[event.stage] = Date.now();
        console.log(`[job:${jobId}] stage_start: ${event.stage}`);
      } else if (event.type === "stage_complete" && event.stage) {
        const elapsed = ((Date.now() - (stageStart[event.stage] ?? Date.now())) / 1000).toFixed(2);
        console.log(`[job:${jobId}] stage_complete: ${event.stage} (${elapsed}s)`);
      } else if (event.type === "stage_error") {
        console.error(`[job:${jobId}] stage_error: ${event.error}`);
      }
    },
  )
    .then((result) => {
      // Convert absolute paths to URL paths served by the /tmp static route
      const toUrl = (p: string) =>
        "/" + path.relative(process.cwd(), p).replace(/\\/g, "/");
      store.complete(jobId, {
        musicxmlPath: toUrl(result.musicxmlPath),
        pdfPath: toUrl(result.pdfPath),
      });
      console.log(`[job:${jobId}] complete`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      store.fail(jobId, message);
      console.error(`[job:${jobId}] failed: ${message}`);
    });

  res.json({ jobId });
});

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
    if (event.type === "pipeline_complete" || event.type === "stage_error") {
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
