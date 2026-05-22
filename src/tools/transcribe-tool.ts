import { readFile } from 'fs/promises';
import { basename } from 'path';
import { BaseTool } from '../tool';
import { ToolParameters } from '../types';

export class TranscribeTool extends BaseTool {
  private pythonServiceUrl: string;

  constructor(pythonServiceUrl: string) {
    super('transcribe_audio', 'Transcribe an audio file to MIDI events with per-note confidence scores using basic-pitch');
    this.pythonServiceUrl = pythonServiceUrl;
  }

  get parameters(): ToolParameters {
    return {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: 'Absolute path to the audio file (WAV or M4A)',
        },
      },
      required: ['audioPath'],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const audioPath = String(params['audioPath']);
    const fileBuffer = await readFile(audioPath);
    const blob = new Blob([fileBuffer]);
    const form = new FormData();
    form.append('audio', blob, basename(audioPath));

    const response = await fetch(`${this.pythonServiceUrl}/transcribe`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Transcription service error: ${response.status} ${response.statusText}`);
    }

    return JSON.stringify(await response.json());
  }
}
