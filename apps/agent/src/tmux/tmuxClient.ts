export type TmuxPaneTarget = {
  session: string;
  pane: string;
};

export function formatTarget(target: TmuxPaneTarget): string {
  return `${target.session}:${target.pane}`;
}

export function buildSendKeysArgs(target: TmuxPaneTarget & { text: string }): string[] {
  return ["tmux", "send-keys", "-t", formatTarget(target), target.text, "C-m"];
}

export function buildCapturePaneArgs(target: TmuxPaneTarget): string[] {
  return ["tmux", "capture-pane", "-p", "-t", formatTarget(target)];
}

export function buildHasSessionArgs(session: string): string[] {
  return ["tmux", "has-session", "-t", session];
}
