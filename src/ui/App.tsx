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
