export type QueueStats = {
  busy: boolean;
  queueDepth: number;
};

type Task<T> = () => Promise<T>;

export class SessionSerialQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly depths = new Map<string, number>();
  private readonly busySet = new Set<string>();

  stats(sessionKey: string): QueueStats {
    return {
      busy: this.busySet.has(sessionKey),
      queueDepth: this.depths.get(sessionKey) ?? 0
    };
  }

  enqueue<T>(sessionKey: string, task: Task<T>): Promise<T> {
    const prev = this.chains.get(sessionKey) ?? Promise.resolve();

    const nextDepth = (this.depths.get(sessionKey) ?? 0) + 1;
    this.depths.set(sessionKey, nextDepth);

    const run = async () => {
      this.busySet.add(sessionKey);
      try {
        return await task();
      } finally {
        const depth = (this.depths.get(sessionKey) ?? 1) - 1;
        if (depth <= 0) this.depths.delete(sessionKey);
        else this.depths.set(sessionKey, depth);

        if ((this.depths.get(sessionKey) ?? 0) === 0) {
          this.busySet.delete(sessionKey);
        }
      }
    };

    const chained = prev.then(run, run);
    this.chains.set(sessionKey, chained.then(() => undefined, () => undefined));
    return chained;
  }
}
