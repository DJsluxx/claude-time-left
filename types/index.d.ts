export type Job = {
  id: string
  kind: 'agent' | 'tool' | 'turn'
  label: string
  /** History bucket the estimate is drawn from, e.g. `agent:Explore`. */
  key: string
  startedAt: number
  endedAt?: number
}

/** Past durations in milliseconds, newest last, per history bucket. */
export type History = Record<string, number[]>

declare module 'claude-code' {
  interface PluginState {
    'time-left': { jobs: Job[]; history: History; now: number }
  }
}
