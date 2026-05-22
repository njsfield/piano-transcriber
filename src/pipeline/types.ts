// src/pipeline/types.ts

export interface MidiEvent {
  id: string;
  pitch: number;
  startMs: number;
  durationMs: number;
  velocity: number;
}

export interface NoteConfidence {
  noteId: string;
  confidence: number;
}

export interface MusicFeatures {
  temposBpm: number[];
  key: string;
  timeSignature: string;
}

export type IssueType = 'short_note' | 'rhythmic_outlier';
export type IssueSeverity = 'low' | 'medium' | 'high';

export interface Issue {
  noteId: string;
  type: IssueType;
  description: string;
  severity: IssueSeverity;
}

export type EditOperationType = 'keep' | 'delete' | 'respell' | 'requantize';

export interface EditOperation {
  type: EditOperationType;
  noteId: string;
  newPitch?: number;
  newDurationMs?: number;
}

export interface AudioInput {
  audioPath: string;
  chordChanges?: string;
}

export interface TranscriptionResult {
  midi: MidiEvent[];
  confidences: NoteConfidence[];
}

export interface AnalysisResult {
  features: MusicFeatures;
  issues: Issue[];
}

export interface CleanupResult {
  operations: EditOperation[];
}

export interface EditorResult {
  midi: MidiEvent[];
}

export interface RendererResult {
  musicxmlPath: string;
  pdfPath: string;
}

export type PipelineStage = 'transcription' | 'analysis' | 'cleanup' | 'editor' | 'renderer';
export type PipelineEventType = 'stage_start' | 'stage_complete' | 'stage_error' | 'pipeline_complete';

export interface PipelineEvent {
  type: PipelineEventType;
  stage?: PipelineStage;
  error?: string;
  result?: RendererResult;
}

export type JobStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface JobState {
  id: string;
  status: JobStatus;
  audioPath: string;
  chordChanges?: string;
  result?: RendererResult;
  error?: string;
  createdAt: Date;
  events: PipelineEvent[];
}
