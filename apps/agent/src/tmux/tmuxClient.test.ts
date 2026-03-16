import { describe, expect, test } from "vitest";
import { buildSendKeysArgs, buildSendEnterArgs, buildCapturePaneArgs } from "./tmuxClient.js";

describe("tmux command builders", () => {
  test("builds send-keys command with literal flag", () => {
    expect(buildSendKeysArgs({ session: "bw-cx", pane: "0", text: "hi" })).toEqual([
      "tmux", "send-keys", "-t", "bw-cx:0", "-l", "hi"
    ]);
  });

  test("builds send-enter command for a pane", () => {
    expect(buildSendEnterArgs({ session: "bw-cx", pane: "0" })).toEqual([
      "tmux", "send-keys", "-t", "bw-cx:0", "C-m"
    ]);
  });

  test("builds capture-pane command for a pane", () => {
    expect(buildCapturePaneArgs({ session: "bw-cx", pane: "0" })).toEqual([
      "tmux", "capture-pane", "-p", "-t", "bw-cx:0"
    ]);
  });
});
