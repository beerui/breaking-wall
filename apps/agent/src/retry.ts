export function computeReconnectDelayMs(attempt: number): number {
  const base = 250;
  const max = 10_000;
  const exp = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(max, exp + jitter);
}
