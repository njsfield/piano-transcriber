import { BaseTool } from '../tool';
import { ToolParameters } from '../types';
import type { MidiEvent, EditOperation } from '../pipeline/types';

export class ApplyOperationsTool extends BaseTool {
  private notes: MidiEvent[];

  constructor(notes: MidiEvent[]) {
    super('apply_operations', 'Apply a list of edit operations (keep/delete/respell/requantize) to the MIDI events');
    this.notes = notes;
  }

  get parameters(): ToolParameters {
    return {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of EditOperation objects',
          items: { type: 'object' },
        },
      },
      required: ['operations'],
    };
  }

  execute(params: Record<string, unknown>): string {
    const operations = (params['operations'] ?? []) as EditOperation[];
    const opMap = new Map(operations.map(op => [op.noteId, op]));

    const result = this.notes
      .filter(note => {
        const op = opMap.get(note.id);
        return !op || op.type !== 'delete';
      })
      .map(note => {
        const op = opMap.get(note.id);
        if (!op || op.type === 'keep') return note;
        if (op.type === 'respell' && op.newPitch !== undefined) {
          return { ...note, pitch: op.newPitch };
        }
        if (op.type === 'requantize' && op.newDurationMs !== undefined) {
          return { ...note, durationMs: op.newDurationMs };
        }
        return note;
      });

    return JSON.stringify(result);
  }
}
