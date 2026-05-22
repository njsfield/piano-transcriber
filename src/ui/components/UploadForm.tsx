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
