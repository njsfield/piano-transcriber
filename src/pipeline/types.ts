// src/pipeline/types.ts

export interface MidiEvent {
  id: string;
  pitch: number;
  startMs: number;
  durationMs: number;
  velocity: number;
}

export interface ChordEvent {
  measure: number; // 1-based
  beat: number;    // 1-based, within the measure
  symbol: string;  // e.g. "Dm7", "G7", "Amaj7"
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

/** Replaces AudioInput. midiPath is the path to the uploaded MIDI binary on disk. */
export interface PipelineInput {
  midiPath: string;
  chords: ChordEvent[];
}

/** Retained for agents/tools that still reference AudioInput internally */
export interface AudioInput {
  audioPath: string;
  chordsXml?: string;
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

export interface HandSeparation {
  leftHand: MidiEvent[];
  rightHand: MidiEvent[];
}

export interface CriterionResult {
  count: number;
  grade: string;       // 'A+' | 'A' | 'A-' | 'B+' ... 'F' | 'n/a'
  examples: string[];  // e.g. ["m7: G#→B→D over E7 (up)"]
  note?: string;       // caveats, e.g. "grace notes unreliable"
}

export interface FeedbackResult {
  arpeggios: CriterionResult;
  scaleRuns: CriterionResult;
  nonChordTones: CriterionResult;
  unresolvedNcts: CriterionResult;
  bluesScale: CriterionResult;
  alteredDominant: CriterionResult;
  interestingPatterns: CriterionResult;
  leaps: CriterionResult;
  motivicDevelopment: CriterionResult;
  expressiveDevices: CriterionResult;
  phraseStartBeats: CriterionResult;
  phraseEndBeats: CriterionResult;
  phraseLength: CriterionResult;
  interPhraseRest: CriterionResult;
  pitchRange: CriterionResult;
  rhythmicUnits: CriterionResult;
  overallGrade: string;
  overallNote: string;
}

export interface RendererResult {
  musicxmlPath: string;
  pdfPath: string;
  feedbackResult?: FeedbackResult;
}

export type PipelineStage = 'transcription' | 'analysis' | 'cleanup' | 'editor' | 'renderer' | 'feedback';
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
  midiPath: string;
  chords: ChordEvent[];
  result?: RendererResult;
  error?: string;
  createdAt: Date;
  events: PipelineEvent[];
}
