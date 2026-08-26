import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
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
    + (usage.outputTokens ?? 0)
}

/** The model a `request/header` snapshot carries, or undefined. */
function modelOf(event: SessionEvent): string | undefined {
  if (event.type !== 'request/header') return undefined
  return event.data.header.config.model
}

/** Local-calendar day key (YYYY-MM-DD) for an event timestamp. */
function dayKey(time: number): string {
  const d = new Date(time)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** One day's totals: grand total plus per-model breakdown. */
export interface DayTotals {
  tokens: number
  byModel: Record<string, number>
}

const zeroDay = (): DayTotals => ({ tokens: 0, byModel: {} })

/** The most recent contribution a session made, so a same-step replacement can subtract it. */
interface LastContribution {
  turn: number
  step: number
  day: string
  model: string
  tokens: number
}

/** Persisted shape: version + per-day totals. */
interface Persisted {
  version: 6
  days: Record<string, DayTotals>
}

/**
 * Per-day token history, persisted under `$DSH_HOME/usage-heatmap/`.
 *
 * Subscribes to `session/event` and folds every usage-bearing event into the
 * local calendar day it belongs to, attributing each sample to the model named
 * by the most recent `request/header` snapshot. A repeated usage sample for
 * the SAME (session, turn, step) — a stream usage chunk followed by the final
 * assistant/message usage — REPLACES the earlier contribution instead of
 * double-counting (the token-meter invariant). On startup it also backfills
 * all PERSISTED session logs through {@link backfill}, so usage from before
 * the plugin was installed is counted.
 */
export class DailyUsageStore {
  private readonly days = new Map<string, DayTotals>()
  private readonly lastContribution = new Map<SessionId, LastContribution>()
  private readonly currentModel = new Map<SessionId, string>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly filename = dshHomePath('usage-heatmap', 'daily-usage.json')

  /**
   * Adopt another store's full state, replacing this instance's. Used at
   * startup to swap in a freshly backfilled accumulator atomically — the
   * persistent store never exposes a half-rebuilt view.
   */
  adopt(other: DailyUsageStore): void {
    this.days.clear()
    for (const [day, value] of other.days) {
      this.days.set(day, { tokens: value.tokens, byModel: { ...value.byModel } })
    }
    this.lastContribution.clear()
    for (const [id, c] of other.lastContribution) this.lastContribution.set(id, { ...c })
    this.currentModel.clear()
    for (const [id, model] of other.currentModel) this.currentModel.set(id, model)
    this.scheduleFlush()
  }

  /** Load the persisted history (best-effort; a missing/corrupt file starts empty). */
  async load(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(this.filename, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Persisted>
      if (parsed.version !== 6 || typeof parsed.days !== 'object' || parsed.days === null) return
      for (const [day, value] of Object.entries(parsed.days)) {
        if (!isDayTotals(value)) continue
        this.days.set(day, { tokens: value.tokens, byModel: { ...value.byModel } })
      }
    } catch {
      // Missing or corrupt history: keep an empty in-memory state rather than
      // crash activation; the next successful flush rewrites the file.
    }
  }

  /** Clear the loaded values before rebuilding from persisted logs. */
  beginBackfill(): void {
    this.days.clear()
    this.currentModel.clear()
    this.lastContribution.clear()
  }

  /** Backfill from one persisted session's event log. */
  backfill(sessionId: SessionId, events: readonly SessionEvent[]): void {
    for (const event of events) {
      this.fold(sessionId, event)
    }
    this.scheduleFlush()
  }

  /** Fold one live session event into the store. */
  consume(session: Session, event: SessionEvent): boolean {
    return this.fold(session.id, event)
  }

  private fold(sessionId: SessionId, event: SessionEvent): boolean {
    // Track the active model from request/header snapshots (they precede the
    // usage events they describe, in seq order).
    const headerModel = modelOf(event)
    if (headerModel !== undefined) {
      this.currentModel.set(sessionId, headerModel)
    }

    const sample = usageOf(event)
    if (sample === undefined) return false
    const prev = this.lastContribution.get(sessionId)
    const sameStep = prev !== undefined && prev.turn === sample.turn && prev.step === sample.step
    const tokens = usageTokenTotal(sample.usage)
    const day = dayKey(event.time)
    const model = this.currentModel.get(sessionId) ?? 'unknown'

    if (sameStep) {
      // Replace the earlier sample for this step: subtract it, add the new one.
      this.addContribution(prev!.day, prev!.model, -prev!.tokens)
      this.lastContribution.set(sessionId, { turn: sample.turn, step: sample.step, day, model, tokens })
      this.addContribution(day, model, tokens)
    } else {
      this.lastContribution.set(sessionId, { turn: sample.turn, step: sample.step, day, model, tokens })
      this.addContribution(day, model, tokens)
    }
    this.scheduleFlush()
    return true
  }

  /** Add a signed token delta to one day's grand total and model bucket. */
  private addContribution(day: string, model: string, delta: number): void {
    const totals = this.days.get(day) ?? zeroDay()
    totals.tokens += delta
    const next = (totals.byModel[model] ?? 0) + delta
    if (next === 0) {
      delete totals.byModel[model]
    } else {
      totals.byModel[model] = next
    }
    if (totals.tokens <= 0 && Object.keys(totals.byModel).length === 0) {
      this.days.delete(day)
    } else {
      this.days.set(day, totals)
    }
  }

  /** Ordered day list (oldest first) plus the whole-history total. */
  snapshot(limitDays: number): {
    days: Array<{ date: string; tokens: number; byModel: Record<string, number> }>
    totals: { tokens: number }
  } {
    const entries = [...this.days.entries()].sort(([a], [b]) => a.localeCompare(b))
    const days = entries.slice(-limitDays).map(([date, value]) => ({
      date,
      tokens: value.tokens,
      byModel: value.byModel,
    }))
    let tokens = 0
    for (const [, value] of entries) tokens += value.tokens
    return { days, totals: { tokens } }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, 500)
  }

  private async flush(): Promise<void> {
    const days: Record<string, DayTotals> = {}
    for (const [day, value] of this.days) days[day] = value
    try {
      await writeFileAtomic(this.filename, JSON.stringify({ version: 6, days }, null, 2), { mode: 0o600, dirMode: 0o700 })
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

function isDayTotals(value: unknown): value is DayTotals {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.tokens !== 'number' || !Number.isFinite(v.tokens)) return false
  if (typeof v.byModel !== 'object' || v.byModel === null) return false
  for (const n of Object.values(v.byModel)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false
  }
  return true
}
