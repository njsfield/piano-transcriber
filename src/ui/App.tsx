// src/ui/App.tsx
import { useState } from 'react';
import { PlaylistSidebar } from './components/PlaylistSidebar';
import { RecorderPanel } from './components/RecorderPanel';
import { PipelineProgress } from './components/PipelineProgress';
import type { Song } from './lib/parse-ireal';

export default function App() {
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const handleReset = () => setJobId(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      <PlaylistSidebar onSongSelected={setSelectedSong} />
      <main className="flex-1 flex flex-col">
        <header className="px-6 py-4 border-b border-zinc-800">
          <h1 className="text-lg font-bold">Piano Transcriber</h1>
        </header>
        <div className="flex-1 flex">
          {jobId ? (
            <PipelineProgress jobId={jobId} onReset={handleReset} />
          ) : (
            <RecorderPanel selectedSong={selectedSong} onJobCreated={setJobId} />
          )}
        </div>
      </main>
    </div>
  );
}
