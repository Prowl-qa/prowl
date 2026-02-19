export type ConcurrencyResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<Array<ConcurrencyResult<T>>> {
  const normalizedConcurrency =
    Number.isFinite(concurrency) && concurrency > 0
      ? Math.floor(concurrency)
      : 1;
  const results: Array<ConcurrencyResult<T>> = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
