import { describe, expect, test } from "vitest";
import { buildSendKeysArgs, buildCapturePaneArgs } from "./tmuxClient.js";

describe("tmux command builders", () => {
  test("builds send-keys command for a pane", () => {
    expect(buildSendKeysArgs({ session: "bw-cx", pane: "0", text: "hi" })).toEqual([
      "tmux", "send-keys", "-t", "bw-cx:0", "hi", "C-m"
    ]);
  });

  test("builds capture-pane command for a pane", () => {
    expect(buildCapturePaneArgs({ session: "bw-cx", pane: "0" })).toEqual([
      "tmux", "capture-pane", "-p", "-t", "bw-cx:0"
    ]);
  });
});
