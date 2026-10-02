import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import type { Env } from '../config/env';
import { LlmError } from './llm/llm.provider';
import { TRIAGE_QUEUE, type TriageJobData } from './triage.constants';
import { TriageService } from './triage.service';

@Processor(TRIAGE_QUEUE)
export class TriageProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    private readonly triageService: TriageService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.concurrency = this.config.get('TRIAGE_CONCURRENCY', {
      infer: true,
    });
  }

  async process(job: Job<TriageJobData>): Promise<void> {
    try {
      await this.triageService.triage(job.data);
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) {
        // Skip remaining attempts: a bad key or malformed output won't fix itself.
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<TriageJobData> | undefined, err: Error) {
    if (!job) return;

    const finalAttempt =
      err instanceof UnrecoverableError ||
      err.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);

    if (!finalAttempt) {
      this.logger.warn(
        `Triage attempt ${job.attemptsMade} for ticket ${job.data.ticketId} failed, will retry: ${err.message}`,
      );
      return;
    }

    this.logger.error(
      `Triage for ticket ${job.data.ticketId} failed permanently: ${err.message}`,
    );
    try {
      await this.triageService.markFailed(job.data, err.message);
    } catch (markErr) {
      const message =
        markErr instanceof Error ? markErr.message : String(markErr);
      this.logger.error(`Could not mark ticket as failed: ${message}`);
    }
  }
}
