export type StreamTimingConfig = {
  streamIdleMs: number;
  firstOutputTimeoutMs: number;
};

export function getFinalizeDelayMs(params: {
  seenData: boolean;
  config: StreamTimingConfig;
}): number {
  return params.seenData ? params.config.streamIdleMs : params.config.firstOutputTimeoutMs;
}
