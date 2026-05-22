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
const upload = multer({
  dest: 'tmp/uploads/',
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => { cb(null, /wav|m4a|audio/.test(file.mimetype)); },
});
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
