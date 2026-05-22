// src/agents/transcription-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { TranscribeTool } from '../tools/transcribe-tool';

const INSTRUCTIONS = `You are a transcription agent in a piano sheet music pipeline.
Use the transcribe_audio tool with the audio file path provided in the task.
After the tool call completes, reply with only the word: DONE`;

export function createTranscriptionAgent(pythonServiceUrl: string): OpenAIAgent {
  return new OpenAIAgent('TranscriptionAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new TranscribeTool(pythonServiceUrl)],
    middleware: [new LoggingMiddleware()],
  });
}
