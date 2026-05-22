// src/pipeline/run-pipeline.ts
import { mkdir } from 'fs/promises';
import type { AgentResponse } from '../types';
import type {
  AudioInput,
  TranscriptionResult,
  AnalysisResult,
  CleanupResult,
  EditorResult,
  RendererResult,
  PipelineEvent,
  PipelineStage,
} from './types';
import { createTranscriptionAgent } from '../agents/transcription-agent';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCleanupAgent } from '../agents/cleanup-agent';
import { createEditorAgent } from '../agents/editor-agent';
import { createRendererAgent } from '../agents/renderer-agent';

export interface PipelineConfig {
  pythonServiceUrl: string;
  jobOutputDir: string;
}

function parseOutput<T>(response: AgentResponse): T {
  const last = [...response.messages].reverse().find(m => m.role === 'assistant');
  if (!last) throw new Error('Agent produced no output');
  const cleaned = last.content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function runPipeline(
  input: AudioInput,
  config: PipelineConfig,
  emit: (event: PipelineEvent) => void,
): Promise<RendererResult> {
  const { pythonServiceUrl, jobOutputDir } = config;
  await mkdir(jobOutputDir, { recursive: true });

  const go = (stage: PipelineStage) => emit({ type: 'stage_start', stage });
  const done = (stage: PipelineStage) => emit({ type: 'stage_complete', stage });

  // Stage 1: Transcription
  go('transcription');
  const transcriptionAgent = createTranscriptionAgent(pythonServiceUrl);
  const transcriptionResponse = await transcriptionAgent.run(
    `Transcribe the audio file at path: ${input.audioPath}. Use the transcribe_audio tool, then return the result as JSON.`,
  );
  const transcription = parseOutput<TranscriptionResult>(transcriptionResponse);
  done('transcription');

  // Stage 2: Analysis
  go('analysis');
  const analysisAgent = createAnalysisAgent(transcription.midi);
  const analysisResponse = await analysisAgent.run(
    `Analyse the MIDI transcription. Use both the extract_features and flag_suspicious tools, then return the combined result as JSON.`,
  );
  const analysis = parseOutput<AnalysisResult>(analysisResponse);
  done('analysis');

  // Stage 3: Cleanup
  go('cleanup');
  const cleanupAgent = createCleanupAgent();
  const cleanupTask = [
    `Review this jazz piano transcription for cleanup.`,
    `\nMIDI events (${transcription.midi.length} notes):\n${JSON.stringify(transcription.midi)}`,
    `\nDetected issues:\n${JSON.stringify(analysis.issues)}`,
    input.chordChanges ? `\nChord changes:\n${input.chordChanges}` : '',
    `\nReturn the operations JSON.`,
  ].join('');
  const cleanupResponse = await cleanupAgent.run(cleanupTask);
  const cleanup = parseOutput<CleanupResult>(cleanupResponse);
  done('cleanup');

  // Stage 4: Editor
  go('editor');
  const editorAgent = createEditorAgent(transcription.midi);
  const editorResponse = await editorAgent.run(
    `Apply these operations to the MIDI:\n${JSON.stringify(cleanup.operations)}\nUse the apply_operations tool and return the result as JSON.`,
  );
  const editor = parseOutput<EditorResult>(editorResponse);
  done('editor');

  // Stage 5: Renderer
  go('renderer');
  const outputDir = jobOutputDir;
  const rendererAgent = createRendererAgent(editor.midi, outputDir);
  const rendererResponse = await rendererAgent.run(
    `Render the MIDI events to MusicXML and PDF. Use the render_midi tool and return the file paths as JSON.`,
  );
  const renderer = parseOutput<RendererResult>(rendererResponse);
  done('renderer');

  return renderer;
}
