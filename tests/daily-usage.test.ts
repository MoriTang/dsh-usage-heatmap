/**
 * Unit tests for DailyUsageStore's event folding and persistence invariants.
 * Run from the plugin directory: `npm test`.
 */
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { DailyUsageStore } from '../src/daily-usage.ts'

const testsDir = dirname(fileURLToPath(import.meta.url))
const atLocalNoon = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day, 12, 0, 0, 0).getTime()

const sessionId = (id: string): SessionId => id as SessionId
const fakeSession = (id: string): Session => ({ id: sessionId(id) }) as Session
const usage = (value: Partial<TokenUsage>): TokenUsage => value as TokenUsage

function usageChunk(
  seq: number,
  time: number,
  value: Partial<TokenUsage>,
  turn = 1,
  step = 1,
): SessionEvent {
  return {
    type: 'assistant/chunk',
    seq,
    time,
    data: { turn, step, chunk: { type: 'usage', usage: usage(value) } },
  } as SessionEvent
}

function assistantMessage(
  seq: number,
  time: number,
  value: Partial<TokenUsage>,
  turn = 1,
  step = 1,
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: {
        id: `message-${seq}`,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'test', model: 'test-model' },
      },
      usage: usage(value),
    },
  } as unknown as SessionEvent
}

function requestHeader(seq: number, time: number, model: string): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time,
    data: {
      header: { config: { provider: 'test', model } },
      reason: seq === 0 ? 'initial' : 'change',
    },
  } as unknown as SessionEvent
}

function stepEnd(seq: number, time: number, turn = 1, step = 1): SessionEvent {
  return { type: 'step/end', seq, time, data: { turn, step } } as SessionEvent
}

function withoutSeq(event: SessionEvent): SessionEvent {
  const { seq: _seq, ...rest } = event
  return rest as unknown as SessionEvent
}

async function makeTempDir(): Promise<{ path: string; usedFallback: boolean }> {
  try {
    return { path: await mkdtemp(join(tmpdir(), 'dsh-usage-heatmap-test-')), usedFallback: false }
  } catch {
    return {
      path: await mkdtemp(join(testsDir, '.tmp-daily-usage-')),
      usedFallback: true,
    }
  }
}

function restoreDshHome(previous: string | undefined): void {
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
}

test('extracts both usage event kinds, sums every token field, and ignores non-usage events', () => {
  const store = new DailyUsageStore({ persist: false })
  const session = fakeSession('extraction')
  const time = atLocalNoon(2026, 1, 2)

  assert.equal(store.consume(session, usageChunk(1, time, {
    inputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 5,
    outputTokens: 7,
  })), true)
  assert.equal(store.consume(session, assistantMessage(2, time, { outputTokens: 11 }, 1, 2)), true)
  assert.equal(store.consume(session, stepEnd(3, time, 1, 2)), false)

  assert.deepEqual(store.snapshot(30), {
    days: [{ date: '2026-01-02', tokens: 28, byModel: { unknown: 28 } }],
    totals: { tokens: 28 },
  })
})

test('attributes usage to the most recent preceding header and switches models mid-session', () => {
  const store = new DailyUsageStore({ persist: false })
  const session = fakeSession('models')
  const time = atLocalNoon(2026, 2, 3)

  store.consume(session, usageChunk(0, time, { inputTokens: 2, outputTokens: 3 }, 1, 1))
  assert.equal(store.consume(session, requestHeader(1, time, 'model-a')), false)
  store.consume(session, usageChunk(2, time, { inputTokens: 7, outputTokens: 0 }, 1, 2))
  assert.equal(store.consume(session, requestHeader(3, time, 'model-b')), false)
  store.consume(session, assistantMessage(4, time, { inputTokens: 0, outputTokens: 11 }, 1, 3))

  assert.deepEqual(store.snapshot(30).days[0], {
    date: '2026-02-03',
    tokens: 23,
    byModel: { unknown: 5, 'model-a': 7, 'model-b': 11 },
  })
})

test('final usage replaces a larger stream sample for the same turn and step', () => {
  const store = new DailyUsageStore({ persist: false })
  const session = fakeSession('smaller-final')
  const time = atLocalNoon(2026, 3, 4)

  store.consume(session, requestHeader(0, time, 'model-a'))
  store.consume(session, usageChunk(1, time, { inputTokens: 80, outputTokens: 20 }))
  store.consume(session, assistantMessage(2, time, { inputTokens: 6, outputTokens: 4 }))

  assert.deepEqual(store.snapshot(30), {
    days: [{ date: '2026-03-04', tokens: 10, byModel: { 'model-a': 10 } }],
    totals: { tokens: 10 },
  })
})

test('a zero replacement removes empty model buckets and empty day entries', () => {
  const time = atLocalNoon(2026, 4, 5)
  const emptyStore = new DailyUsageStore({ persist: false })
  const only = fakeSession('only-contribution')
  emptyStore.consume(only, requestHeader(0, time, 'model-a'))
  emptyStore.consume(only, usageChunk(1, time, { inputTokens: 9, outputTokens: 1 }))
  emptyStore.consume(only, assistantMessage(2, time, { inputTokens: 0, outputTokens: 0 }))
  assert.deepEqual(emptyStore.snapshot(30), { days: [], totals: { tokens: 0 } })

  const sharedStore = new DailyUsageStore({ persist: false })
  const zeroed = fakeSession('zeroed-model')
  const retained = fakeSession('retained-model')
  sharedStore.consume(zeroed, requestHeader(0, time, 'model-a'))
  sharedStore.consume(retained, requestHeader(0, time, 'model-b'))
  sharedStore.consume(zeroed, usageChunk(1, time, { inputTokens: 10, outputTokens: 0 }))
  sharedStore.consume(retained, usageChunk(1, time, { inputTokens: 5, outputTokens: 0 }))
  sharedStore.consume(zeroed, assistantMessage(2, time, { inputTokens: 0, outputTokens: 0 }))
  assert.deepEqual(sharedStore.snapshot(30).days[0], {
    date: '2026-04-05',
    tokens: 5,
    byModel: { 'model-b': 5 },
  })
})

test('distinct steps accumulate while distinct sessions replace independently on a shared day', () => {
  const store = new DailyUsageStore({ persist: false })
  const first = fakeSession('first-session')
  const second = fakeSession('second-session')
  const time = atLocalNoon(2026, 5, 6)

  store.consume(first, requestHeader(0, time, 'shared-model'))
  store.consume(second, requestHeader(0, time, 'shared-model'))
  store.consume(first, usageChunk(1, time, { inputTokens: 10, outputTokens: 0 }, 1, 1))
  store.consume(first, usageChunk(2, time, { inputTokens: 7, outputTokens: 0 }, 1, 2))
  store.consume(second, usageChunk(1, time, { inputTokens: 20, outputTokens: 0 }, 1, 1))
  store.consume(first, assistantMessage(3, time, { inputTokens: 4, outputTokens: 0 }, 1, 2))

  assert.deepEqual(store.snapshot(30), {
    days: [{ date: '2026-05-06', tokens: 34, byModel: { 'shared-model': 34 } }],
    totals: { tokens: 34 },
  })
})

test('snapshot orders oldest first, keeps newest limited days, totals all days, and detaches byModel', () => {
  const store = new DailyUsageStore({ persist: false })
  const dates = [
    ['2026-06-03', atLocalNoon(2026, 6, 3), 3],
    ['2026-06-01', atLocalNoon(2026, 6, 1), 1],
    ['2026-06-02', atLocalNoon(2026, 6, 2), 2],
  ] as const

  for (const [date, time, tokens] of dates) {
    const session = fakeSession(date)
    store.consume(session, requestHeader(0, time, date))
    store.consume(session, usageChunk(1, time, { inputTokens: tokens, outputTokens: 0 }))
  }

  const limited = store.snapshot(2)
  assert.deepEqual(limited.days.map(day => day.date), ['2026-06-02', '2026-06-03'])
  assert.equal(limited.totals.tokens, 6)
  limited.days[0].byModel['2026-06-02'] = 999
  limited.days[0].tokens = 999

  assert.deepEqual(store.snapshot(2).days[0], {
    date: '2026-06-02',
    tokens: 2,
    byModel: { '2026-06-02': 2 },
  })
})

test('backfill folds events and records only the greatest present sequence number', () => {
  const store = new DailyUsageStore({ persist: false })
  const id = sessionId('backfilled')
  const noSeqId = sessionId('no-seq')
  const time = atLocalNoon(2026, 7, 7)

  store.backfill(id, [
    requestHeader(2, time, 'model-a'),
    usageChunk(9, time, { inputTokens: 6, outputTokens: 4 }),
    stepEnd(4, time),
  ])
  assert.equal(store.maxBackfilledSeq(id), 9)
  assert.equal(store.maxBackfilledSeq(sessionId('unknown-session')), -1)
  assert.equal(store.snapshot(30).totals.tokens, 10)

  store.backfill(id, [withoutSeq(stepEnd(100, time))])
  assert.equal(store.maxBackfilledSeq(id), 9)
  store.backfill(noSeqId, [withoutSeq(usageChunk(100, time, { inputTokens: 3, outputTokens: 0 }))])
  assert.equal(store.maxBackfilledSeq(noSeqId), -1)
})

test('persist:false performs no disk writes, including after the debounce window', async () => {
  const temp = await makeTempDir()
  const home = join(temp.path, 'memory-only-home')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const store = new DailyUsageStore({ persist: false })
    const session = fakeSession('memory-only')
    const time = atLocalNoon(2026, 8, 8)
    store.consume(session, requestHeader(0, time, 'model-a'))
    store.consume(session, usageChunk(1, time, { inputTokens: 4, outputTokens: 5 }))
    assert.equal(store.snapshot(30).totals.tokens, 9)
    await new Promise(resolve => setTimeout(resolve, 550))
    await store.dispose()
    await assert.rejects(access(home), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
  } finally {
    restoreDshHome(previous)
    await rm(temp.path, { recursive: true, force: true })
  }
})

test('adopt copies days, replacement state, active model, and backfill watermark', () => {
  const candidate = new DailyUsageStore({ persist: false })
  const adopted = new DailyUsageStore({ persist: false })
  const id = sessionId('adopted-session')
  const session = fakeSession(id)
  const time = atLocalNoon(2026, 9, 9)

  candidate.backfill(id, [
    requestHeader(3, time, 'model-a'),
    usageChunk(7, time, { inputTokens: 8, outputTokens: 4 }),
  ])
  adopted.adopt(candidate)
  assert.deepEqual(adopted.snapshot(30), candidate.snapshot(30))
  assert.equal(adopted.maxBackfilledSeq(id), 7)

  candidate.beginBackfill()
  assert.equal(candidate.snapshot(30).totals.tokens, 0)
  adopted.consume(session, assistantMessage(8, time, { inputTokens: 3, outputTokens: 2 }))
  assert.deepEqual(adopted.snapshot(30), {
    days: [{ date: '2026-09-09', tokens: 5, byModel: { 'model-a': 5 } }],
    totals: { tokens: 5 },
  })
  assert.equal(adopted.maxBackfilledSeq(id), 7)
})

test('dispose flushes version 6 synchronously and a fresh store loads the same totals', async () => {
  const temp = await makeTempDir()
  const home = join(temp.path, 'persistent-home')
  const filename = join(home, 'usage-heatmap', 'daily-usage.json')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const store = new DailyUsageStore()
    const session = fakeSession('persistent')
    const time = atLocalNoon(2026, 10, 10)
    store.consume(session, requestHeader(0, time, 'model-a'))
    store.consume(session, usageChunk(1, time, {
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheWriteTokens: 30,
      outputTokens: 40,
    }))
    const before = store.snapshot(365)

    await store.dispose()
    const persisted = JSON.parse(await readFile(filename, 'utf8')) as { version: number }
    assert.equal(persisted.version, 6)

    const loaded = new DailyUsageStore({ persist: false })
    await loaded.load()
    assert.deepEqual(loaded.snapshot(365), before)
  } finally {
    restoreDshHome(previous)
    await rm(temp.path, { recursive: true, force: true })
  }
})

test('load tolerates missing, corrupt, wrong-version, and malformed day data', async () => {
  const temp = await makeTempDir()
  const previous = process.env.DSH_HOME
  const cases: Array<{ name: string; content?: string }> = [
    { name: 'missing' },
    { name: 'corrupt', content: '{not json' },
    { name: 'wrong-version', content: JSON.stringify({
      version: 4,
      days: { '2026-11-11': { tokens: 10, byModel: { model: 10 } } },
    }) },
    { name: 'malformed-days', content: JSON.stringify({
      version: 6,
      days: {
        '2026-11-11': { tokens: '10', byModel: {} },
        '2026-11-12': { tokens: 10, byModel: null },
        '2026-11-13': { tokens: 10, byModel: { model: '10' } },
      },
    }) },
  ]

  try {
    for (const fixture of cases) {
      const home = join(temp.path, fixture.name)
      process.env.DSH_HOME = home
      if (fixture.content !== undefined) {
        const filename = join(home, 'usage-heatmap', 'daily-usage.json')
        await mkdir(dirname(filename), { recursive: true })
        await writeFile(filename, fixture.content)
      }
      const store = new DailyUsageStore({ persist: false })
      await assert.doesNotReject(store.load())
      assert.deepEqual(store.snapshot(365), { days: [], totals: { tokens: 0 } }, fixture.name)
    }
  } finally {
    restoreDshHome(previous)
    await rm(temp.path, { recursive: true, force: true })
  }
})
