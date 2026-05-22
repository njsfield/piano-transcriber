// src/agents/analysis-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { ExtractFeaturesTool } from '../tools/extract-features-tool';
import { FlagSuspiciousTool } from '../tools/flag-suspicious-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a music analysis agent in a piano transcription pipeline.
You have two tools: extract_features and flag_suspicious.
Call both tools on the provided MIDI data.
Synthesise the results and return a JSON object:
{"features": {"temposBpm": [...], "key": "...", "timeSignature": "..."}, "issues": [...]}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createAnalysisAgent(notes: MidiEvent[]): OpenAIAgent {
  return new OpenAIAgent('AnalysisAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new ExtractFeaturesTool(notes), new FlagSuspiciousTool(notes)],
  });
}
