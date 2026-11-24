import type { IEntryProcessor } from '@/modules/entry-processor/interfaces/entry-processor.interface';

/**
 * Processor instances are long-lived Nest singletons and keep per-run state
 * (the active company and company-specific lookup caches). Two uploads for
 * different companies that overlap on the same processor would overwrite each
 * other's state, so every enrich/validate/post run for a processor type is
 * executed one at a time and starts from empty company-scoped caches.
 *
 * Scope of the guarantee: a single Node process (the API and the BullMQ worker
 * share it). Runs for different processor types are not serialized.
 */
const tails = new Map<string, Promise<void>>();

export function runExclusiveByKey<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
  return result;
}

/**
 * Runs `task` while holding the processor's lock. The processor is switched to
 * `company` and its company-scoped caches are cleared before the task starts,
 * so nothing loaded for another company can be read by this run.
 */
export function runProcessorForCompany<T>(
  processor: IEntryProcessor,
  company: string,
  task: () => Promise<T>,
): Promise<T> {
  return runExclusiveByKey(
    `processor:${processor.entryProcessorType}`,
    async () => {
      processor.resetCompanyScopedState?.(company);
      await processor.prepareCompanyRun?.(company);
      return task();
    },
  );
}
