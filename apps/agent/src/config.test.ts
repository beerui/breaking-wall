import { describe, expect, test } from "vitest";
import { parseSessionTargets } from "./config.js";

describe("parseSessionTargets", () => {
  test("parses cc/cx tmux session targets", () => {
    expect(parseSessionTargets("cc=bw-cc:0;cx=bw-cx:1")).toEqual({
      cc: { session: "bw-cc", pane: "0" },
      cx: { session: "bw-cx", pane: "1" }
    });
  });
});
