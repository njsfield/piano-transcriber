// src/agents/renderer-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { RenderTool } from '../tools/render-tool';
import type { HandSeparation } from '../pipeline/types';

const INSTRUCTIONS = `You are a rendering agent in a piano transcription pipeline.
Use the render_midi tool to convert the MIDI events into MusicXML and PDF files.
After the tool call completes, reply with only the word: DONE`;

export function createRendererAgent(hands: HandSeparation, outputDir: string): OpenAIAgent {
  return new OpenAIAgent('RendererAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new RenderTool(hands, outputDir)],
    middleware: [new LoggingMiddleware()],
    maxIterations: 2,
  });
}
