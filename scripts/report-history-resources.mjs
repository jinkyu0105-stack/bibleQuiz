// Optional local Vitest reporter. Only synthetic numeric resource measurements;
// never raw queries, bindings, text, IDs, checksums or errors.
export default class HistoryResourceReporter {
  onTestCaseResult(test) {
    const measurements = test.meta().historyResources;
    if (measurements) process.stdout.write(`P5_24_MEASURE ${JSON.stringify(measurements)}\n`);
  }
}
