import type { JobState, PipelineEvent, RendererResult, ChordEvent } from '../pipeline/types';

type Subscriber = (event: PipelineEvent) => void;

export class JobStore {
  private jobs = new Map<string, JobState>();
  private subscribers = new Map<string, Set<Subscriber>>();

  create(id: string, input: { midiPath: string; chords: ChordEvent[] }): JobState {
    const job: JobState = {
      id,
      status: 'pending',
      midiPath: input.midiPath,
      chords: input.chords,
      createdAt: new Date(),
      events: [],
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id);
  }

  addEvent(id: string, event: PipelineEvent): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(event);
    if (job.status === 'pending') job.status = 'running';
    this.notify(id, event);
  }

  complete(id: string, result: RendererResult): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'complete';
    job.result = result;
    const event: PipelineEvent = { type: 'pipeline_complete', result };
    job.events.push(event);
    this.notify(id, event);
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    const event: PipelineEvent = { type: 'stage_error', error };
    job.events.push(event);
    this.notify(id, event);
  }

  subscribe(id: string, cb: Subscriber): () => void {
    if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
    this.subscribers.get(id)!.add(cb);
    return () => this.subscribers.get(id)?.delete(cb);
  }

  private notify(id: string, event: PipelineEvent): void {
    const subs = this.subscribers.get(id);
    if (subs) for (const sub of subs) sub(event);
  }
}
