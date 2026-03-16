import { describe, expect, test } from "vitest";
import { SessionSerialQueue } from "./queue.js";

describe("SessionSerialQueue", () => {
  test("runs tasks serially per session", async () => {
    const q = new SessionSerialQueue();
    const order: string[] = [];

    const a = q.enqueue("s", async () => {
      order.push("a1");
      await new Promise((r) => setTimeout(r, 10));
      order.push("a2");
    });

    const b = q.enqueue("s", async () => {
      order.push("b1");
    });

    await Promise.all([a, b]);
    expect(order).toEqual(["a1", "a2", "b1"]);
  });

  test("stats reports queueDepth", async () => {
    const q = new SessionSerialQueue();
    const p = q.enqueue("s", async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const stats = q.stats("s");
    expect(stats.queueDepth).toBeGreaterThanOrEqual(1);
    await p;
  });
});
