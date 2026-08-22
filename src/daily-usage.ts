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

/** Local-calendar day key (YYYY-MM-DD) for an event timestamp. */
function dayKey(time: number): string {
  const d = new Date(time)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * DeepSeek peak/off-peak billing. Peak = Beijing time 09:00-12:00 and
 * 14:00-18:00 on weekdays; weekends are all off-peak (rule effective
 * 2026-08-23). `time` is a Unix-epoch-millis event timestamp.
 */
export function isPeakTime(time: number): boolean {
  const beijing = new Date(time + 8 * 3_600_000) // UTC+8
  const day = beijing.getUTCDay() // 0=Sun … 6=Sat
  const hour = beijing.getUTCHours()
  if (day === 0 || day === 6) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/**
 * Per-million-token prices. DeepSeek bills input and output separately, and
 * distinguishes cache-hit vs cache-miss input; each has a peak and an
 * off-peak rate. Values are in the configured currency unit (CNY).
 */
export interface Pricing {
  /** Cache-miss input, peak (¥/M tokens). */
  inputMissPeakPerM: number
  /** Cache-miss input, off-peak. */
  inputMissOffPerM: number
  /** Cache-hit input, peak. */
  inputHitPeakPerM: number
  /** Cache-hit input, off-peak. */
  inputHitOffPerM: number
  /** Output, peak. */
  outputPeakPerM: number
  /** Output, off-peak. */
  outputOffPerM: number
}

/** One day's token buckets, split by peak/off-peak so cost is recomputable. */
export interface DayBuckets {
  /** Cache-miss input tokens (harness `inputTokens`). */
  inputMissPeak: number
  inputMissOff: number
  /** Cache-hit input tokens (harness `cacheReadTokens`). */
  inputHitPeak: number
  inputHitOff: number
  /** Output tokens (harness `outputTokens`). */
  outputPeak: number
  outputOff: number
}

const zeroBuckets = (): DayBuckets => ({
  inputMissPeak: 0, inputMissOff: 0,
  inputHitPeak: 0, inputHitOff: 0,
  outputPeak: 0, outputOff: 0,
})

/** Total tokens across all buckets. */
export function bucketTokens(b: DayBuckets): number {
  return b.inputMissPeak + b.inputMissOff + b.inputHitPeak + b.inputHitOff + b.outputPeak + b.outputOff
}

/** Cost of one day's buckets under the configured pricing. */
export function bucketCost(b: DayBuckets, pricing: Pricing): number {
  return b.inputMissPeak / 1e6 * pricing.inputMissPeakPerM
    + b.inputMissOff / 1e6 * pricing.inputMissOffPerM
    + b.inputHitPeak / 1e6 * pricing.inputHitPeakPerM
    + b.inputHitOff / 1e6 * pricing.inputHitOffPerM
    + b.outputPeak / 1e6 * pricing.outputPeakPerM
    + b.outputOff / 1e6 * pricing.outputOffPerM
}

/** Persisted shape: version + per-day token buckets. */
interface Persisted {
  version: 2
  days: Record<string, DayBuckets>
}

/**
 * Per-day token history, persisted under `$DSH_HOME/usage-heatmap/`.
 *
 * Subscribes to `session/event` and, for every usage-bearing event, folds the
 * sample's tokens into the local calendar day's peak/off-peak buckets. Cost
 * is NOT persisted — it is derived from the buckets and the current pricing
 * at read time, so a price correction recomputes history instead of baking in
 * stale estimates. Per-session turn/step dedup prevents a step whose usage
 * arrives both as a stream chunk and as the final message from
 * double-counting. Only committed events reach this counter (constructor
 * seeds do not emit), so replayed logs never double-count.
 */
export class DailyUsageStore {
  private readonly days = new Map<string, DayBuckets>()
  private readonly lastStep = new WeakMap<Session, { turn: number; step: number }>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly filename = dshHomePath('usage-heatmap', 'daily-usage.json')

  constructor(private readonly pricing: Pricing) {}

  /** Load the persisted history (best-effort; a missing/corrupt file starts empty). */
  async load(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(this.filename, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Persisted>
      // Only accept the v2 bucket format; older formats (token/cost totals)
      // cannot be repriced and are dropped rather than served as wrong cost.
      if (parsed.version !== 2 || typeof parsed.days !== 'object' || parsed.days === null) return
      for (const [day, value] of Object.entries(parsed.days)) {
        if (!isDayBuckets(value)) continue
        this.days.set(day, { ...value })
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
    const peak = isPeakTime(event.time)
    const entry = this.days.get(day) ?? zeroBuckets()
    const usage = sample.usage
    if (peak) {
      entry.inputMissPeak += usage.inputTokens
      entry.inputHitPeak += usage.cacheReadTokens ?? 0
      entry.outputPeak += usage.outputTokens
    } else {
      entry.inputMissOff += usage.inputTokens
      entry.inputHitOff += usage.cacheReadTokens ?? 0
      entry.outputOff += usage.outputTokens
    }
    this.days.set(day, entry)
    this.scheduleFlush()
    return true
  }

  /** Ordered day list (oldest first) with tokens and cost derived from pricing. */
  snapshot(limitDays: number): {
    days: Array<{ date: string; tokens: number; cost: number }>
    totals: { tokens: number; cost: number }
  } {
    const entries = [...this.days.entries()].sort(([a], [b]) => a.localeCompare(b))
    const days = entries.slice(-limitDays).map(([date, buckets]) => ({
      date,
      tokens: bucketTokens(buckets),
      cost: bucketCost(buckets, this.pricing),
    }))
    let tokens = 0
    let cost = 0
    for (const [, buckets] of entries) {
      tokens += bucketTokens(buckets)
      cost += bucketCost(buckets, this.pricing)
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
    const days: Record<string, DayBuckets> = {}
    for (const [day, value] of this.days) days[day] = value
    try {
      await writeFileAtomic(this.filename, JSON.stringify({ version: 2, days }, null, 2), { mode: 0o600, dirMode: 0o700 })
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

function isDayBuckets(value: unknown): value is DayBuckets {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const keys: Array<keyof DayBuckets> = [
    'inputMissPeak', 'inputMissOff', 'inputHitPeak', 'inputHitOff', 'outputPeak', 'outputOff',
  ]
  return keys.every(k => typeof v[k] === 'number' && Number.isFinite(v[k] as number))
}
