import { describe, it, expect, vi } from 'vitest';
import { JobStore } from './job-store';

describe('JobStore', () => {
  it('creates a job with pending status', () => {
    const store = new JobStore();
    store.create('job1', { midiPath: '/tmp/test.mid', chords: [] });
    const job = store.get('job1')!;
    expect(job.status).toBe('pending');
    expect(job.midiPath).toBe('/tmp/test.mid');
    expect(job.events).toHaveLength(0);
  });

  it('addEvent transitions status to running and notifies subscribers', () => {
    const store = new JobStore();
    store.create('job1', { midiPath: '/tmp/test.mid', chords: [] });
    const cb = vi.fn();
    store.subscribe('job1', cb);
    store.addEvent('job1', { type: 'stage_start', stage: 'transcription' });
    expect(store.get('job1')!.status).toBe('running');
    expect(cb).toHaveBeenCalledWith({ type: 'stage_start', stage: 'transcription' });
  });

  it('complete sets status and result', () => {
    const store = new JobStore();
    store.create('job1', { midiPath: '/tmp/test.mid', chords: [] });
    const result = { musicxmlPath: '/tmp/out.xml', pdfPath: '/tmp/out.pdf' };
    store.complete('job1', result);
    const job = store.get('job1')!;
    expect(job.status).toBe('complete');
    expect(job.result).toEqual(result);
  });

  it('fail sets status and error', () => {
    const store = new JobStore();
    store.create('job1', { midiPath: '/tmp/test.mid', chords: [] });
    store.fail('job1', 'something broke');
    expect(store.get('job1')!.status).toBe('failed');
    expect(store.get('job1')!.error).toBe('something broke');
  });

  it('unsubscribe stops receiving events', () => {
    const store = new JobStore();
    store.create('job1', { midiPath: '/tmp/test.mid', chords: [] });
    const cb = vi.fn();
    const unsub = store.subscribe('job1', cb);
    unsub();
    store.addEvent('job1', { type: 'stage_start', stage: 'analysis' });
    expect(cb).not.toHaveBeenCalled();
  });
});
