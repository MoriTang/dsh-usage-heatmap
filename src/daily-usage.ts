import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** Extract provider usage from a session event, if any (mirrors token-meter). */
function usageOf(event: SessionEvent): { turn: number; step: number; usage: TokenUsage } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/** Total tokens in one usage sample (input + output + cache traffic). */
function usageTokenTotal(usage: TokenUsage): number {
  return usage.inputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
    + usage.outputTokens
}

/** Local-calendar day key (YYYY-MM-DD) for an event timestamp. */
function dayKey(time: number): string {
  const d = new Date(time)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Per-million-token prices, in the same currency as the display. */
export interface Pricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheWritePerM: number
}

/** Cost of one usage sample under the configured pricing. */
function costOf(pricing: Pricing, usage: TokenUsage): number {
  return usage.inputTokens / 1e6 * pricing.inputPerM
    + (usage.cacheReadTokens ?? 0) / 1e6 * pricing.cacheReadPerM
    + (usage.cacheWriteTokens ?? 0) / 1e6 * pricing.cacheWritePerM
    + usage.outputTokens / 1e6 * pricing.outputPerM
}

/**
 * Per-day token/cost history, persisted under `$DSH_HOME/usage-heatmap/`.
 *
 * Subscribes to `session/event` and, for every usage-bearing event, folds the
 * sample's token total and estimated cost into the local calendar day the
 * event belongs to. Per-session turn/step dedup prevents a step whose usage
 * arrives both as a stream chunk and as the final message from double-counting
 * (the same invariant token-meter relies on). Persistence is a debounced
 * atomic JSON rewrite; on startup the last file is loaded so a restart keeps
 * the history. Only committed session events reach this counter (constructor
 * seeds do not emit), so replayed logs never double-count.
 */
export class DailyUsageStore {
  private readonly days = new Map<string, { tokens: number; cost: number }>()
  private readonly lastStep = new WeakMap<Session, { turn: number; step: number }>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly filename = dshHomePath('usage-heatmap', 'daily-usage.json')

  constructor(private readonly pricing: Pricing) {}

  /** Load the persisted history (best-effort; a missing/corrupt file starts empty). */
  async load(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(this.filename, 'utf8')
      const parsed = JSON.parse(raw) as { days?: Record<string, { tokens: number; cost: number }> }
      for (const [day, value] of Object.entries(parsed.days ?? {})) {
        if (typeof value?.tokens === 'number' && typeof value?.cost === 'number') {
          this.days.set(day, { tokens: value.tokens, cost: value.cost })
        }
      }
    } catch {
      // Missing or corrupt history: keep an empty in-memory state rather than
      // crash activation; the next successful flush rewrites the file.
    }
  }

  /** Fold one session event into the store. Returns true when the day changed. */
  consume(session: Session, event: SessionEvent): boolean {
    const sample = usageOf(event)
    if (sample === undefined) return false
    const prev = this.lastStep.get(session)
    if (prev !== undefined && prev.turn === sample.turn && prev.step === sample.step) return false
    this.lastStep.set(session, { turn: sample.turn, step: sample.step })

    const day = dayKey(event.time)
    const entry = this.days.get(day) ?? { tokens: 0, cost: 0 }
    entry.tokens += usageTokenTotal(sample.usage)
    entry.cost += costOf(this.pricing, sample.usage)
    this.days.set(day, entry)
    this.scheduleFlush()
    return true
  }

  /** Ordered day list (oldest first) plus the whole-history totals. */
  snapshot(limitDays: number): {
    days: Array<{ date: string; tokens: number; cost: number }>
    totals: { tokens: number; cost: number }
  } {
    const entries = [...this.days.entries()].sort(([a], [b]) => a.localeCompare(b))
    const days = entries.slice(-limitDays).map(([date, value]) => ({ date, ...value }))
    let tokens = 0
    let cost = 0
    for (const [, value] of entries) {
      tokens += value.tokens
      cost += value.cost
    }
    return { days, totals: { tokens, cost } }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, 500)
  }

  private async flush(): Promise<void> {
    const days: Record<string, { tokens: number; cost: number }> = {}
    for (const [day, value] of this.days) days[day] = value
    try {
      await writeFileAtomic(this.filename, JSON.stringify({ days }, null, 2), { mode: 0o600, dirMode: 0o700 })
    } catch {
      // Persistence failure must never crash the session pipeline; the next
      // consume schedules another flush.
    }
  }

  /** Flush any pending write (used before the fiber unloads). */
  async dispose(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flush()
  }
}
