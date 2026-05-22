// src/ui/components/PipelineProgress.tsx
import { useEffect, useState } from 'react';
import { DownloadPanel } from './DownloadPanel';
import type { PipelineStage, PipelineEvent, RendererResult } from '../../pipeline/types';

type StageStatus = 'pending' | 'running' | 'complete' | 'error';

const STAGES: PipelineStage[] = ['transcription', 'analysis', 'cleanup', 'editor', 'renderer'];
const LABELS: Record<PipelineStage, string> = {
  transcription: 'Transcription',
  analysis: 'Analysis',
  cleanup: 'Cleanup',
  editor: 'Editor',
  renderer: 'Renderer',
};

interface Props {
  jobId: string;
  onReset: () => void;
}

export function PipelineProgress({ jobId, onReset }: Props) {
  const [stages, setStages] = useState<Record<PipelineStage, StageStatus>>({
    transcription: 'pending', analysis: 'pending', cleanup: 'pending',
    editor: 'pending', renderer: 'pending',
  });
  const [result, setResult] = useState<RendererResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as PipelineEvent;
      if (event.type === 'stage_start' && event.stage) {
        setStages(s => ({ ...s, [event.stage!]: 'running' }));
      } else if (event.type === 'stage_complete' && event.stage) {
        setStages(s => ({ ...s, [event.stage!]: 'complete' }));
      } else if (event.type === 'stage_error') {
        setError(event.error ?? 'Pipeline failed');
        es.close();
      } else if (event.type === 'pipeline_complete' && event.result) {
        setResult(event.result);
        es.close();
      }
    };

    es.onerror = () => { setError('Connection lost'); es.close(); };
    return () => es.close();
  }, [jobId]);

  const icon = (status: StageStatus) => {
    if (status === 'complete') return '✓';
    if (status === 'running') return '⟳';
    if (status === 'error') return '✗';
    return '○';
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-lg font-semibold">Transcribing…</h2>
      <ul className="space-y-2">
        {STAGES.map(stage => (
          <li key={stage} className="flex items-center gap-3">
            <span className={`text-lg w-6 ${stages[stage] === 'complete' ? 'text-green-400' : stages[stage] === 'running' ? 'text-yellow-400 animate-spin' : stages[stage] === 'error' ? 'text-red-400' : 'text-zinc-600'}`}>
              {icon(stages[stage])}
            </span>
            <span className={stages[stage] === 'pending' ? 'text-zinc-500' : ''}>{LABELS[stage]}</span>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {result && <DownloadPanel musicxmlPath={result.musicxmlPath} pdfPath={result.pdfPath} />}
      {(result || error) && (
        <button onClick={onReset} className="text-sm text-zinc-400 hover:text-white underline mt-4">
          Transcribe another file
        </button>
      )}
    </div>
  );
}
