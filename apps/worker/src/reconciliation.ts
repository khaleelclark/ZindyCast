import type { JobRepository } from '@zindycast/jobs';
import type { InstallationRepository } from '@zindycast/installations';

/** Trusted, synchronous bounded maintenance. No provider calls or caller authorization. */
export class AdmissionReconciler {
  private afterId: string | undefined;
  constructor(private readonly jobs: JobRepository, private readonly installations: InstallationRepository) {}
  runBatch(batchSize = 100): { examined: number; released: number } {
    const ids = this.installations.listActiveJobIds(batchSize, this.afterId);
    let released = 0;
    for (const id of ids) {
      // Commit retry fence first. Missing rows include reserve-before-enqueue and are ambiguous.
      if (this.jobs.closeTerminalAdmission(id) && this.installations.releaseJob(id)) released++;
    }
    // Advance only after success; exceptions leave the page retryable. Wrap after a short page.
    this.afterId = ids.length === batchSize ? ids.at(-1) : undefined;
    return { examined: ids.length, released };
  }
}
