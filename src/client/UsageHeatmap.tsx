import { useEffect, useMemo, useState } from 'react'

/** One day cell in the history series. */
export interface HistoryDay {
  date: string
  tokens: number
}

export interface HistoryTotals {
  tokens: number
}

export interface BalanceInfo {
  currency: 'CNY' | 'USD'
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export interface HistoryPayload {
  days: HistoryDay[]
  totals: HistoryTotals
  balance: {
    is_available: boolean
    balance_infos: BalanceInfo[]
  } | null
  checkedAt: number
  lastError: string | null
}

/** Fetch the history route once, then refresh on the given interval. */
export function useHistory(intervalMs: number): HistoryPayload | null {
  const [payload, setPayload] = useState<HistoryPayload | null>(null)
  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch('/usage-heatmap/history')
        if (!res.ok) return
        const data = (await res.json()) as HistoryPayload
        if (!cancelled) setPayload(data)
      } catch {
        // Keep the previous value on transient failures.
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [intervalMs])
  return payload
}

/** Compact token count: 517 / 12.2K / 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) {
    const v = n / 1_000
    return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}K`
  }
  const v = n / 1_000_000
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}M`
}

/** GitHub-style contribution color levels (0 → none … 4 → darkest). */
function heatLevel(value: number, max: number): number {
  if (value <= 0) return 0
  const ratio = max <= 0 ? 0 : value / max
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
}

/** 0 = Sunday. */
function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00`).getDay()
}

const LEVEL_COLORS = [
  'var(--dsw-alias-fill-l3)',
  'var(--dsw-chart-1, #2f81f7)',
  'var(--dsw-chart-2, #a371f7)',
  'var(--dsw-chart-3, #d29922)',
  'var(--dsw-chart-4, #f85149)',
]

function Cell({ day, level }: { day: HistoryDay | null; level: number }) {
  const title = day === null ? undefined : `${day.date} · ${formatTokens(day.tokens)} tokens`
  return (
    <span
      title={title}
      style={{
        width: 11,
        height: 11,
        borderRadius: 2,
        background: LEVEL_COLORS[level],
        opacity: level === 0 ? 0.35 : 1,
      }}
    />
  )
}

/**
 * Heat-map grid: one cell per day, color intensity scales with that day's
 * token consumption relative to the peak day in the window.
 */
export function TokenHeatmap({ days }: { days: HistoryDay[] }) {
  const max = useMemo(() => days.reduce((acc, d) => Math.max(acc, d.tokens), 0), [days])
  // Build week columns for a GitHub-like calendar (oldest left, newest right).
  const weeks = useMemo(() => {
    const out: Array<Array<HistoryDay | null>> = []
    // Pad to a full week boundary so the first column starts on the week's
    // first day (weekday of the earliest date).
    const first = days[0]
    const pad = first === undefined ? 0 : dayOfWeek(first.date)
    const padded: Array<HistoryDay | null> = [...Array<HistoryDay | null>(pad).fill(null), ...days]
    for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7))
    return out
  }, [days])

  return (
    <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {week.map((day, di) => (
            <Cell key={di} day={day} level={day === null ? 0 : heatLevel(day.tokens, max)} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Summary card: total balance and whole-history token total. */
export function SummaryCards({ payload }: { payload: HistoryPayload }) {
  const cny = payload.balance?.balance_infos.find(info => info.currency === 'CNY')
    ?? payload.balance?.balance_infos[0]
  const symbol = cny?.currency === 'USD' ? '$' : '¥'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
      <SummaryCard label="Total balance" value={cny === undefined ? '—' : `${symbol}${cny.total_balance}`} />
      <SummaryCard label="Tokens (all time)" value={formatTokens(payload.totals.tokens)} />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 8,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      }}>{label}</span>
      <span style={{
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 20,
        lineHeight: '28px',
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--dsw-font-mono, monospace)',
      }}>{value}</span>
    </div>
  )
}
