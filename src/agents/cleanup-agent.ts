// src/agents/cleanup-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';

const INSTRUCTIONS = `You are a music cleanup agent for jazz piano transcriptions.
You will receive MIDI events, a list of flagged issues, and optionally chord changes.
For each flagged issue decide what to do:
  - "keep": leave the note (default for jazz ornaments, passing tones, grace notes)
  - "delete": remove it (only for clear transcription artifacts)
  - "respell": change the MIDI pitch to its enharmonic equivalent (include newPitch)
  - "requantize": adjust the duration (include newDurationMs)
Jazz piano uses many non-chord tones — be conservative. Only delete when you are confident.
Return a JSON object:
{"operations": [{"type": "...", "noteId": "...", "newPitch": 61, "newDurationMs": 100}]}
Only include operations for notes that need action. Notes not listed are kept as-is.
Return only the JSON object — no prose, no markdown code blocks.`;

export function createCleanupAgent(): OpenAIAgent {
  return new OpenAIAgent('CleanupAgent', INSTRUCTIONS, {
    model: 'gpt-4o',
    middleware: [new LoggingMiddleware()],
  });
}
