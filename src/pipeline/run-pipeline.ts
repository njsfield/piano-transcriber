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
  ChordEvent,
} from './types';
import { createTranscriptionAgent } from '../agents/transcription-agent';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCleanupAgent } from '../agents/cleanup-agent';
import { createEditorAgent } from '../agents/editor-agent';
import { createRendererAgent } from '../agents/renderer-agent';
import { parseChordsXml } from '../tools/parse-chords';
import { injectHarmonies } from '../tools/inject-harmonies';

export interface PipelineConfig {
  pythonServiceUrl: string;
  jobOutputDir: string;
}

function parseOutput<T>(response: AgentResponse): T {
  const strip = (s: string) => s.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  // Try the final assistant message first (used by reasoning agents like CleanupAgent)
  const lastAssistant = [...response.messages].reverse().find(m => m.role === 'assistant');
  if (lastAssistant?.content) {
    try { return JSON.parse(strip(lastAssistant.content)) as T; } catch {}
  }

  // Fall back to the last tool message — used by passthrough agents (Transcription,
  // Editor, Renderer) whose instructions say DONE instead of re-echoing large JSON.
  const lastTool = [...response.messages].reverse().find(m => m.role === 'tool');
  if (lastTool?.content) {
    // Surface tool errors directly rather than masking them as a JSON parse failure.
    if ('success' in lastTool && lastTool.success === false) {
      throw new Error(lastTool.content);
    }
    try { return JSON.parse(strip(lastTool.content)) as T; } catch {}
  }

  throw new Error('Agent produced no parseable JSON output');
}

export async function runPipeline(
  input: AudioInput,
  config: PipelineConfig,
  emit: (event: PipelineEvent) => void,
): Promise<RendererResult> {
  const { pythonServiceUrl, jobOutputDir } = config;
  await mkdir(jobOutputDir, { recursive: true });

  const chords: ChordEvent[] = input.chordsXml ? parseChordsXml(input.chordsXml) : [];

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
  const chordContext = chords.length > 0
    ? `\nChord chart: ${chords.map(c => `bar ${c.measure} beat ${c.beat}: ${c.symbol}`).join(', ')}`
    : '';
  const analysisResponse = await analysisAgent.run(
    `Analyse the MIDI transcription. Use both the extract_features and flag_suspicious tools, then return the combined result as JSON.${chordContext}`,
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
    chords.length > 0
      ? `\nChord chart: ${chords.map(c => `bar ${c.measure} beat ${c.beat}: ${c.symbol}`).join(', ')}`
      : '',
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

  if (chords.length > 0) {
    await injectHarmonies(renderer.musicxmlPath, chords, analysis.features.temposBpm);
  }

  return renderer;
}
