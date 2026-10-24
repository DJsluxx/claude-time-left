import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { History, Job } from '../types'

const PANE = 'time-left'
const STORE_KEY = 'history'
const KEEP_RUNS = 20
const KEEP_DONE = 8
const SHOW_TOOL_AFTER_MS = 2000
const BAR_WIDTH = 14

const jobs = atom({ plugin: 'time-left', key: 'jobs' } as const, [])
const history = atom({ plugin: 'time-left', key: 'history' } as const, {})
const now = atom({ plugin: 'time-left', key: 'now' } as const, 0)

// Used until a bucket has a run of its own to learn from.
const DEFAULT_MS: Record<string, number> = {
  'agent:Explore': 90_000,
  'agent:Plan': 120_000,
  agent: 180_000,
  'tool:Bash': 20_000,
  'tool:Workflow': 600_000,
  tool: 10_000,
  turn: 60_000,
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const hi = s[mid] ?? 0
  return s.length % 2 ? hi : ((s[mid - 1] ?? hi) + hi) / 2
}

const estimate = (key: string, past: History): { ms: number; isGuess: boolean } => {
  const runs = past[key]
  if (runs && runs.length > 0) return { ms: median(runs), isGuess: false }
  const kind = key.split(':')[0] ?? key
  return { ms: DEFAULT_MS[key] ?? DEFAULT_MS[kind] ?? 60_000, isGuess: true }
}

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const bar = (fraction: number): string => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const trim = (list: Job[]): Job[] => {
  const running = list.filter(j => j.endedAt === undefined)
  const done = list.filter(j => j.endedAt !== undefined).slice(-KEEP_DONE)
  return [...running, ...done].sort((a, b) => a.startedAt - b.startedAt)
}

async function start($: EngineInterface, job: Omit<Job, 'startedAt'>): Promise<void> {
  const t = await $.clock.now()
  await update($, now, () => t)
  await update($, jobs, list =>
    trim([...list.filter(j => j.id !== job.id), { ...job, startedAt: t }]),
  )
}

async function finish($: EngineInterface, id: string, isAborted = false): Promise<void> {
  const t = await $.clock.now()
  const list = await read($, jobs)
  const job = list.find(j => j.id === id && j.endedAt === undefined)
  if (!job) return
  await update($, jobs, l => trim(l.map(j => (j.id === id && j.endedAt === undefined ? { ...j, endedAt: t } : j))))
  if (isAborted) return
  const past = await update($, history, h => ({
    ...h,
    [job.key]: [...(h[job.key] ?? []), t - job.startedAt].slice(-KEEP_RUNS),
  }))
  await $.store.set(STORE_KEY, past)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as History | undefined
    if (saved) await update($, history, h => ({ ...saved, ...h }))
    await $.command.register({
      name: 'time-left',
      description: 'Show the time-left pane for running agents and tasks',
    })
    $.clock.every(1000, () => {
      void tick($)
    })
    void openPane($)
    return next(e)
  })

  // The desktop window can attach after the session starts: open then.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    void openPane($)
    return attached
  })

  on('command.run', { command: 'time-left' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Time left' })
    return { text: 'Time-left pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if ('agentId' in spawned && spawned.agentId) {
      await start($, {
        id: spawned.agentId,
        kind: 'agent',
        label: `${e.subagentType}: ${e.description}`,
        key: `agent:${e.subagentType}`,
      })
    }
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) void openPane($)
    if (e.agentId) await resumeAgent($, e.agentId)
    else await start($, { id: 'turn', kind: 'turn', label: 'This turn', key: 'turn' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await finish($, e.agentId ?? 'turn', e.isAborted)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' || e.agentId) return next(e)
    await start($, { id: e.tool_use_id, kind: 'tool', label: e.tool, key: `tool:${e.tool}` })
    try {
      return await next(e)
    } finally {
      await finish($, e.tool_use_id)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, now)
    const past = await read($, history)
    const visible = (await read($, jobs)).filter(
      j => j.kind !== 'tool' || (j.endedAt ?? t) - j.startedAt >= SHOW_TOOL_AFTER_MS,
    )
    const running = visible.filter(j => j.endedAt === undefined)
    const done = visible.filter(j => j.endedAt !== undefined).reverse()

    return (
      <Box flexDirection="column">
        {running.length === 0 && <Text dimColor>Nothing running.</Text>}
        {running.map(job => {
          const est = estimate(job.key, past)
          const elapsed = Math.max(0, t - job.startedAt)
          const left = est.ms - elapsed
          const guess = est.isGuess ? ' (guess)' : ''
          return (
            <Box flexDirection="column">
              <Text bold>{job.label}</Text>
              <Text>
                {bar(elapsed / est.ms)} {fmt(elapsed)} /{' '}
                {left >= 0 ? `~${fmt(left)} left${guess}` : `over by ${fmt(-left)}`}
              </Text>
            </Box>
          )
        })}
        {done.length > 0 && <Text dimColor>── finished ──</Text>}
        {done.map(job => (
          <Text dimColor>
            ✓ {job.label} in {fmt((job.endedAt ?? 0) - job.startedAt)}
          </Text>
        ))}
      </Box>
    )
  })
}

let isPaneOpened = false

// Opens the pane once a surface can draw it; a session with none yet waits.
async function openPane($: EngineInterface): Promise<void> {
  if (isPaneOpened) return
  try {
    const surfaces = await $.session.surfaces()
    if (surfaces.length === 0) return
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Time left' })
    isPaneOpened = isPlaced
  } catch {
    // No surface yet: the next attach or turn tries again.
  }
}

// Bumps the clock value the pane reads, only while something runs.
async function tick($: EngineInterface): Promise<void> {
  const list = await read($, jobs)
  if (!list.some(j => j.endedAt === undefined)) return
  const t = await $.clock.now()
  await update($, now, () => t)
}

// A subagent's loop can start a run without a spawn this mod saw
// (a resume, or a reload mid-run): track it from the agent list.
async function resumeAgent($: EngineInterface, agentId: string): Promise<void> {
  const list = await read($, jobs)
  const job = list.find(j => j.id === agentId)
  if (job && job.endedAt === undefined) return
  const info = (await $.agent.list()).find(a => a.id === agentId)
  const type = info?.type ?? 'agent'
  await start($, {
    id: agentId,
    kind: 'agent',
    label: job?.label ?? `${type}: ${info?.description ?? agentId}`,
    key: job?.key ?? `agent:${type}`,
  })
}
