export function diffPaneOutput(previous: string, current: string): string {
  if (!previous) return current;
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(previous.length - overlap) === current.slice(0, overlap)) {
      return current.slice(overlap);
    }
  }

  return current;
}
