// src/agents/editor-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { ApplyOperationsTool } from '../tools/apply-operations-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a MIDI editor agent. You receive a list of edit operations.
Use the apply_operations tool, passing the operations array.
Return the result as a JSON object:
{"midi": [...]}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createEditorAgent(notes: MidiEvent[]): OpenAIAgent {
  return new OpenAIAgent('EditorAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new ApplyOperationsTool(notes)],
    middleware: [new LoggingMiddleware()],
  });
}
