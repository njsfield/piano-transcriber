// src/agents/editor-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { ApplyOperationsTool } from '../tools/apply-operations-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a MIDI editor agent. You receive a list of edit operations.
Use the apply_operations tool, passing the operations array.
After the tool call completes, reply with only the word: DONE`;

export function createEditorAgent(notes: MidiEvent[]): OpenAIAgent {
  return new OpenAIAgent('EditorAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new ApplyOperationsTool(notes)],
    middleware: [new LoggingMiddleware()],
  });
}
