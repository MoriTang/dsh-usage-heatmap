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
    + usage.outputTokens
}

/** Local-calendar day key (YYYY-MM-DD) for an event timestamp. */
function dayKey(time: number): string {
  const d = new Date(time)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Persisted shape: version + per-day token totals. */
interface Persisted {
  version: 4
  days: Record<string, number>
}

/**
 * Per-day token history, persisted under `$DSH_HOME/usage-heatmap/`.
 *
 * Subscribes to `session/event` and folds every usage-bearing event into the
 * local calendar day it belongs to. On startup it also backfills all
 * PERSISTED session logs, so usage from before the plugin was installed is
 * counted instead of only the events observed after mount. Dedup is keyed by
 * (sessionId, turn, step): a step whose usage arrives both as a stream chunk
 * and as the final message counts once, and a live event never double-counts
 * against the backfilled log of the same session.
 */
export class DailyUsageStore {
  private readonly days = new Map<string, number>()
  private readonly lastStep = new Map<SessionId, { turn: number; step: number }>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly filename = dshHomePath('usage-heatmap', 'daily-usage.json')

  /** Load the persisted history (best-effort; a missing/corrupt file starts empty). */
  async load(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(this.filename, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Persisted>
      // Only accept the v4 format (plain per-day token totals); older
      // bucket/total formats are dropped rather than served as wrong data.
      if (parsed.version !== 4 || typeof parsed.days !== 'object' || parsed.days === null) return
      for (const [day, value] of Object.entries(parsed.days)) {
        if (typeof value === 'number' && Number.isFinite(value)) this.days.set(day, value)
      }
    } catch {
      // Missing or corrupt history: keep an empty in-memory state rather than
      // crash activation; the next successful flush rewrites the file.
    }
  }

  /**
   * Clear the loaded values before rebuilding from persisted logs. The logs
   * are the authoritative source: days are recomputed from scratch and the
   * file's loaded values (which miss events committed before mount) are
   * discarded. Called only when a session persistence service is available.
   */
  beginBackfill(): void {
    this.days.clear()
  }

  /**
   * Backfill from one persisted session's event log. Days aggregate across
   * sessions; the (sessionId, turn, step) dedup key is shared with
   * {@link consume}, so a session that later resumes cannot double-count its
   * replayed seed against the live events.
   */
  backfill(sessionId: SessionId, events: readonly SessionEvent[]): void {
    for (const event of events) {
      this.fold(sessionId, event)
    }
    this.scheduleFlush()
  }

  /** Fold one live session event into the store. Returns true when the day changed. */
  consume(session: Session, event: SessionEvent): boolean {
    return this.fold(session.id, event)
  }

  private fold(sessionId: SessionId, event: SessionEvent): boolean {
    const sample = usageOf(event)
    if (sample === undefined) return false
    const prev = this.lastStep.get(sessionId)
    if (prev !== undefined && prev.turn === sample.turn && prev.step === sample.step) return false
    this.lastStep.set(sessionId, { turn: sample.turn, step: sample.step })

    const day = dayKey(event.time)
    this.days.set(day, (this.days.get(day) ?? 0) + usageTokenTotal(sample.usage))
    this.scheduleFlush()
    return true
  }

  /** Ordered day list (oldest first) plus the whole-history total. */
  snapshot(limitDays: number): {
    days: Array<{ date: string; tokens: number }>
    totals: { tokens: number }
  } {
    const entries = [...this.days.entries()].sort(([a], [b]) => a.localeCompare(b))
    const days = entries.slice(-limitDays).map(([date, tokens]) => ({ date, tokens }))
    let tokens = 0
    for (const [, value] of entries) tokens += value
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
    const days: Record<string, number> = {}
    for (const [day, value] of this.days) days[day] = value
    try {
      await writeFileAtomic(this.filename, JSON.stringify({ version: 4, days }, null, 2), { mode: 0o600, dirMode: 0o700 })
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
