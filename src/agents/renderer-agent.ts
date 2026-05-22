// src/agents/renderer-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { RenderTool } from '../tools/render-tool';
import type { MidiEvent } from '../pipeline/types';

const INSTRUCTIONS = `You are a rendering agent in a piano transcription pipeline.
Use the render_midi tool to convert the MIDI events into MusicXML and PDF files.
Return a JSON object:
{"musicxmlPath": "...", "pdfPath": "..."}
Return only the JSON object — no prose, no markdown code blocks.`;

export function createRendererAgent(notes: MidiEvent[], outputDir: string): OpenAIAgent {
  return new OpenAIAgent('RendererAgent', INSTRUCTIONS, {
    model: 'gpt-4o-mini',
    tools: [new RenderTool(notes, outputDir)],
    middleware: [new LoggingMiddleware()],
  });
}
