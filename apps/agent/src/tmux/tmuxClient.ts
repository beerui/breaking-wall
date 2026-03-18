export type TmuxPaneTarget = {
  session: string;
  pane: string;
};

export function formatTarget(target: TmuxPaneTarget): string {
  return `${target.session}:${target.pane}`;
}

export function buildSendKeysArgs(target: TmuxPaneTarget & { text: string }): string[] {
  return ["tmux", "send-keys", "-t", formatTarget(target), "-l", target.text];
}

export function buildSendEnterArgs(target: TmuxPaneTarget): string[] {
  return ["tmux", "send-keys", "-t", formatTarget(target), "C-m"];
}

export function buildSendKeyArgs(target: TmuxPaneTarget & { key: string }): string[] {
  return ["tmux", "send-keys", "-t", formatTarget(target), target.key];
}

export function buildCapturePaneArgs(target: TmuxPaneTarget): string[] {
  return ["tmux", "capture-pane", "-p", "-t", formatTarget(target)];
}

export function buildHasSessionArgs(session: string): string[] {
  return ["tmux", "has-session", "-t", session];
}

export function buildNewSessionArgs(session: string): string[] {
  return ["tmux", "new-session", "-d", "-s", session];
}
