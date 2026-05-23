// src/server/server.ts
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "path";
import { readFileSync } from "fs";
import { JobStore } from "./job-store";
import { runPipeline } from "../pipeline/run-pipeline";

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
    if (file.fieldname === 'chordsXml') {
      cb(null, true);
    } else {
      cb(null, /wav|m4a|audio/.test(file.mimetype));
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

app.post("/api/jobs", upload.fields([{ name: "audio", maxCount: 1 }, { name: "chordsXml", maxCount: 1 }]), (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const audioFile = files?.["audio"]?.[0];
  const chordsFile = files?.["chordsXml"]?.[0];

  if (!audioFile) {
    res.status(400).json({ error: "audio file required" });
    return;
  }

  let chordsXml: string | undefined;
  if (chordsFile) {
    let rawXml: string;
    try {
      rawXml = readFileSync(chordsFile.path, "utf-8");
    } catch {
      res.status(400).json({ error: "Failed to read chord chart file" });
      return;
    }
    if (!rawXml.includes("<harmony>")) {
      res.status(400).json({ error: "chordsXml file contains no chord symbols. Upload an iReal Pro MusicXML export." });
      return;
    }
    chordsXml = rawXml;
  }

  const jobId = randomUUID();
  const audioPath = path.resolve(audioFile.path);
  const jobOutputDir = path.join(JOBS_DIR, jobId);

  store.create(jobId, { audioPath, chordsXml });
  console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} created file=${audioFile.originalname}`);

  const stageStart: Record<string, number> = {};

  runPipeline(
    { audioPath, chordsXml },
    { pythonServiceUrl: PYTHON_URL, jobOutputDir },
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
      // Convert absolute paths to URL paths served by the /tmp static route
      const toUrl = (p: string) =>
        "/" + path.relative(process.cwd(), p).replace(/\\/g, "/");
      store.complete(jobId, {
        musicxmlPath: toUrl(result.musicxmlPath),
        pdfPath: toUrl(result.pdfPath),
      });
      console.log(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.green}${C.bold}complete${C.reset}`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      store.fail(jobId, message);
      console.error(`${C.bold}${C.cyan}[job:${jobId}]${C.reset} ${C.red}${C.bold}failed:${C.reset}${C.red} ${message}${C.reset}`);
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
