// src/pipeline/run-pipeline.ts
import { mkdir } from 'fs/promises';
import type { AgentResponse } from '../types';
import type {
  PipelineInput,
  TranscriptionResult,
  AnalysisResult,
  CleanupResult,
  EditorResult,
  RendererResult,
  FeedbackResult,
  PipelineEvent,
  PipelineStage,
  ChordEvent,
} from './types';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCleanupAgent } from '../agents/cleanup-agent';
import { createEditorAgent } from '../agents/editor-agent';
import { createRendererAgent } from '../agents/renderer-agent';
import { createImprovFeedbackAgent } from '../agents/improv-feedback-agent';
import { parseMidi } from '../tools/parse-midi';
import { classifyHands } from '../tools/classify-hands';
import type { HandSeparation } from './types';

export interface PipelineConfig {
  jobOutputDir: string;
}

function parseOutput<T>(response: AgentResponse): T {
  const strip = (s: string) => s.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  const lastAssistant = [...response.messages].reverse().find(m => m.role === 'assistant');
  if (lastAssistant?.content) {
    try { return JSON.parse(strip(lastAssistant.content)) as T; } catch {}
  }

  const lastTool = [...response.messages].reverse().find(m => m.role === 'tool');
  if (lastTool?.content) {
    if ('success' in lastTool && lastTool.success === false) {
      throw new Error(lastTool.content);
    }
    try { return JSON.parse(strip(lastTool.content)) as T; } catch {}
  }

  throw new Error('Agent produced no parseable JSON output');
}

export async function runPipeline(
  input: PipelineInput,
  config: PipelineConfig,
  emit: (event: PipelineEvent) => void,
): Promise<RendererResult> {
  const { jobOutputDir } = config;
  await mkdir(jobOutputDir, { recursive: true });

  const chords: ChordEvent[] = input.chords;

  const go = (stage: PipelineStage) => emit({ type: 'stage_start', stage });
  const done = (stage: PipelineStage) => emit({ type: 'stage_complete', stage });

  // Stage 1: Transcription — parse MIDI binary directly, no agent
  go('transcription');
  const transcription = await parseMidi(input.midiPath);
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

  const beatsPerMeasure = parseInt(analysis.features.timeSignature.split('/')[0] ?? '4', 10);
  const hands = classifyHands(
    transcription.midi,
    chords,
    analysis.features.temposBpm[0] ?? 120,
    beatsPerMeasure,
  );

  // Stage 3: Cleanup
  go('cleanup');
  const cleanupAgent = createCleanupAgent();
  const handContext = hands.leftHand.length > 0 || hands.rightHand.length > 0
    ? [
        `\nHand classification:`,
        `  Left hand (shell voicings, chord tones): ${hands.leftHand.length} notes — be very conservative, these are harmonic.`,
        `  Right hand (solo improvisation): ${hands.rightHand.length} notes — apply normal cleanup judgment.`,
        `  Left hand note IDs: ${hands.leftHand.map(n => n.id).join(', ')}`,
      ].join('\n')
    : '';

  const cleanupTask = [
    `Review this jazz piano transcription for cleanup.`,
    `\nMIDI events (${transcription.midi.length} notes):\n${JSON.stringify(transcription.midi)}`,
    `\nDetected issues:\n${JSON.stringify(analysis.issues)}`,
    chords.length > 0
      ? `\nChord chart: ${chords.map(c => `bar ${c.measure} beat ${c.beat}: ${c.symbol}`).join(', ')}`
      : '',
    handContext,
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
  const lhIds = new Set(hands.leftHand.map(n => n.id));
  const handsAfterEdit: HandSeparation = {
    leftHand: editor.midi.filter(n => lhIds.has(n.id)),
    rightHand: editor.midi.filter(n => !lhIds.has(n.id)),
  };

  const rendererAgent = createRendererAgent(handsAfterEdit, jobOutputDir);
  const rendererResponse = await rendererAgent.run(
    `Render the MIDI events to MusicXML and PDF. Use the render_midi tool and return the file paths as JSON.`,
  );
  const renderer = parseOutput<RendererResult>(rendererResponse);
  done('renderer');

  if (chords.length > 0) {
    const { injectHarmonies } = await import('../tools/inject-harmonies');
    const firstNoteMs = transcription.midi.length > 0
      ? Math.min(...transcription.midi.map(n => n.startMs))
      : 0;
    const tempo = analysis.features.temposBpm[0] ?? 120;
    const msPerMeasure = (60000 / tempo) * beatsPerMeasure;
    const measureOffset = Math.floor(firstNoteMs / msPerMeasure);
    const shiftedChords = measureOffset > 0
      ? chords.map(c => ({ ...c, measure: c.measure + measureOffset }))
      : chords;
    await injectHarmonies(renderer.musicxmlPath, shiftedChords, analysis.features.temposBpm);
  }

  // Stage 6: Feedback (non-fatal — if it fails, pipeline still succeeds)
  go('feedback');
  let feedbackResult: FeedbackResult | undefined;
  try {
    const feedbackAgent = createImprovFeedbackAgent(
      renderer.musicxmlPath,
      handsAfterEdit.rightHand,
      chords,
      analysis.features,
    );
    const feedbackResponse = await feedbackAgent.run(
      'Analyse this jazz piano improvisation and return the FeedbackResult JSON.',
    );
    feedbackResult = parseOutput<FeedbackResult>(feedbackResponse);
  } catch {
    // Feedback failure is non-fatal; feedbackResult stays undefined
  }
  done('feedback');

  return { ...renderer, feedbackResult };
}
