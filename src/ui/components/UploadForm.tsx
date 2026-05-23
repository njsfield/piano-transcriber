import { useState, useRef } from 'react';

interface Props {
  onJobCreated: (jobId: string) => void;
}

export function UploadForm({ onJobCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const chordsRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const audioFile = audioRef.current?.files?.[0];
    if (!audioFile) { setError('Please select an audio file'); return; }

    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append('audio', audioFile);
    const chordsFile = chordsRef.current?.files?.[0];
    if (chordsFile) form.append('chordsXml', chordsFile);

    try {
      const res = await fetch('/api/jobs', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server error: ${res.status}`);
      }
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
          ref={audioRef}
          type="file"
          accept=".wav,.m4a,audio/wav,audio/x-m4a"
          className="block w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">
          Chord chart — iReal Pro MusicXML export (optional)
        </label>
        <input
          ref={chordsRef}
          type="file"
          accept=".musicxml,.xml"
          className="block w-full text-sm border border-zinc-700 rounded p-2 bg-zinc-900"
        />
        <p className="text-xs text-zinc-500 mt-1">
          In iReal Pro: share song → MusicXML
        </p>
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
