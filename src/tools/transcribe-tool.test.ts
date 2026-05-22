import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscribeTool } from './transcribe-tool';

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake audio data')),
}));

const mockResult = {
  midi: [{ id: 'n1', pitch: 60, startMs: 0, durationMs: 500, velocity: 80 }],
  confidences: [{ noteId: 'n1', confidence: 0.9 }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockResult,
  }));
});

describe('TranscribeTool', () => {
  it('posts audio file to python service and returns JSON string', async () => {
    const tool = new TranscribeTool('http://localhost:8000');
    const result = await tool.execute({ audioPath: '/tmp/test.wav' });
    expect(JSON.parse(result as string)).toEqual(mockResult);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/transcribe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));
    const tool = new TranscribeTool('http://localhost:8000');
    await expect(tool.execute({ audioPath: '/tmp/test.wav' })).rejects.toThrow('500');
  });
});
