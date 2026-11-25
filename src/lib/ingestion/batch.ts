/** Rotates a list so successive invocations start from a different item (fair when a time budget cuts a run short). */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export interface BatchOutcome<T, R> {
  /** Results for the items that ran, in input order. */
  results: R[];
  /** Items never started because `shouldStop` said the time budget was used up. */
  skipped: T[];
}

/**
 * Runs `task` over `items` in batches of `size` (a batch runs concurrently). `shouldStop` is checked before
 * each batch except the first, so at least one batch always runs. Tasks must handle their own errors: one
 * rejection here would reject the whole batch.
 */
export async function runInBatches<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<R>,
  shouldStop: () => boolean = () => false,
): Promise<BatchOutcome<T, R>> {
  const batchSize = Math.max(1, Math.floor(size));
  const results: R[] = [];
  const skipped: T[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    if (index > 0 && shouldStop()) {
      skipped.push(...batch);
      continue;
    }
    results.push(...(await Promise.all(batch.map(task))));
  }
  return { results, skipped };
}

/**
 * A window of `size` consecutive items starting at `counter * size` (wrapping). With an invocation counter that
 * rises by one per scheduled run, successive runs walk through the whole list: eight items at two per run are
 * all visited every four runs.
 */
export function pickWindow<T>(items: readonly T[], counter: number, size: number): T[] {
  if (items.length === 0 || size < 1) return [];
  const take = Math.min(Math.floor(size), items.length);
  return rotate(items, (Math.floor(counter) * take) % items.length).slice(0, take);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
