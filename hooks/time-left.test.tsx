import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'time-left',
  component: 'Pane',
  requestId: 'time-left',
  props: {
    title: 'Time left',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a subagent shows time left, then finishes', async ($, on) => {
  on('command.register', () => ({ value: { command: 'time-left' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'look around',
    description: 'Find files',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Explore: Find files/ }))?.text).toBe(
      'Explore: Find files',
    )
    expect(await ui.find({ type: 'Text', text: /left \(guess\)/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 'x',
    agentId: 'a1',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /✓ Explore: Find files in/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nothing running/ })).toBeDefined()
  await ui.unmount()
})
