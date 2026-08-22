import { useEffect, useMemo, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

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

/** Full token count with thousands separators (for the hover tooltip). */
function formatTokensFull(n: number): string {
  return n.toLocaleString('en-US')
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

const LEVEL_COLORS = [
  'var(--dsw-alias-fill-l3)',
  'var(--dsw-chart-1, #2f81f7)',
  'var(--dsw-chart-2, #a371f7)',
  'var(--dsw-chart-3, #d29922)',
  'var(--dsw-chart-4, #f85149)',
]

const DAY_MS = 86_400_000

/** Local date key (YYYY-MM-DD) for a Date. */
function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Start-of-day (local midnight) for a Date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** One positioned cell: the day it represents (or null for a padding slot) and its token count. */
interface GridCell {
  date: string
  tokens: number
  /** True for days after today (future padding to complete the last week). */
  future: boolean
}

/**
 * Build the GitHub-style calendar grid over the last `days` days.
 *
 * The grid is laid out as rows = weekday (Sun→Sat) and columns = weeks,
 * oldest week leftmost. The window ends today and starts `days` days back;
 * both ends are padded to full week boundaries so every row/column lines up.
 * Days with no recorded usage still get a (level-0) cell — the calendar
 * covers the whole year, not just active days.
 */
function buildGrid(days: HistoryDay[], windowDays: number): { cells: GridCell[]; monthLabels: Array<{ col: number; label: string }> } {
  const byDate = new Map(days.map(d => [d.date, d.tokens]))
  const today = startOfDay(new Date())

  // Start: `windowDays` days before today, then snap back to the week's Sunday.
  const start = startOfDay(new Date(today.getTime() - (windowDays - 1) * DAY_MS))
  const startSunday = new Date(start.getTime() - start.getDay() * DAY_MS)

  const cells: GridCell[] = []
  const monthLabels: Array<{ col: number; label: string }> = []
  const cursor = new Date(startSunday)
  while (cursor.getTime() <= today.getTime()) {
    const index = cells.length
    // A month label marks the column containing that month's first day
    // (GitHub places the label over the 1st's column).
    if (cursor.getDate() === 1) {
      monthLabels.push({ col: Math.floor(index / 7), label: MONTH_NAMES[cursor.getMonth()] })
    }
    const key = dateKey(cursor)
    cells.push({ date: key, tokens: byDate.get(key) ?? 0, future: false })
    cursor.setDate(cursor.getDate() + 1)
  }

  // Pad the trailing week to Saturday so the last column is complete.
  while (cursor.getDay() !== 0) {
    const key = dateKey(cursor)
    cells.push({ date: key, tokens: 0, future: true })
    cursor.setDate(cursor.getDate() + 1)
  }

  return { cells, monthLabels }
}

/**
 * Heat-map grid, GitHub contributions style: one cell per day, rows are
 * weekdays and columns are weeks, with a month label row on top. Color
 * intensity scales with that day's token consumption relative to the peak day
 * in the window; hovering a cell shows its date and exact token count.
 *
 * The grid uses CSS Grid so every column stretches to share the container
 * width — 53 weeks fit one screen with no horizontal scrollbar, regardless of
 * the settings panel width. Cells keep a square shape via `aspect-ratio: 1`.
 *
 * Grid coordinate system (1-based):
 * - column 1 = weekday label gutter, columns 2..N+1 = week columns
 * - row 1 = month label row, rows 2..8 = Sun..Sat
 */
export function TokenHeatmap({ days }: { days: HistoryDay[] }) {
  const max = useMemo(() => days.reduce((acc, d) => Math.max(acc, d.tokens), 0), [days])
  const { cells, monthLabels } = useMemo(() => buildGrid(days, 365), [days])
  const colCount = Math.ceil(cells.length / 7)

  // 0-based week index → 1-based grid column (skip the weekday gutter column).
  const weekCol = (week: number): number => week + 2
  // 0-based weekday (0=Sun) → 1-based grid row (skip the month label row).
  const weekdayRow = (weekday: number): number => weekday + 2

  // Each month label spans from its own week column to the column just before
  // the next month's label (or the last column), so the full label always has
  // room and never gets clipped by a single narrow column.
  const monthSpans = monthLabels.map((m, i) => {
    const start = m.col
    const end = i + 1 < monthLabels.length ? monthLabels[i + 1].col - 1 : colCount - 1
    return { ...m, start, span: Math.max(1, end - start + 1) }
  })

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `30px repeat(${colCount}, minmax(0, 1fr))`,
        gridAutoRows: 'auto',
        columnGap: 1,
        rowGap: 1,
        alignItems: 'stretch',
      }}
    >
      {/* Month labels (row 1): each spans to the next month's column so the
          full label fits without clipping. */}
      {monthSpans.map(({ col, label, span }) => (
        <span
          key={label}
          style={{
            gridColumn: `${weekCol(col)} / span ${span}`,
            gridRow: 1,
            fontSize: 9,
            lineHeight: '12px',
            color: 'var(--dsw-alias-label-tertiary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
          }}
        >
          {label}
        </span>
      ))}

      {/* Weekday labels (column 1): rows 2..8 = Sun..Sat. */}
      {WEEKDAY_NAMES.map((name, weekday) => (
        <span
          key={name}
          style={{
            gridColumn: 1,
            gridRow: weekdayRow(weekday),
            fontSize: 8,
            lineHeight: '10px',
            color: 'var(--dsw-alias-label-tertiary)',
            alignSelf: 'center',
            opacity: weekday % 2 === 1 ? 1 : 0.55,
          }}
        >
          {name}
        </span>
      ))}

      {/* Day cells. */}
      {cells.map((cell, index) => {
        const week = Math.floor(index / 7)
        const weekday = index % 7
        const level = heatLevel(cell.tokens, max)
        return (
          <div key={index} style={{ gridColumn: weekCol(week), gridRow: weekdayRow(weekday) }}>
            <Cell cell={cell} level={level} />
          </div>
        )
      })}
    </div>
  )
}

function Cell({ cell, level }: { cell: GridCell | null; level: number }) {
  if (cell === null) {
    return <span style={{ display: 'block', width: '100%', aspectRatio: '1', borderRadius: 2, background: 'transparent' }} />
  }
  // Future cells (padding to complete the last week) still draw a visible
  // level-0 square so the calendar rectangle stays complete.
  if (cell.future) {
    return <span style={cellBaseStyle(LEVEL_COLORS[0])} />
  }
  const label = `${cell.date} · ${formatTokensFull(cell.tokens)} tokens`
  return (
    <Tooltip label={label} side="top">
      <span style={cellBaseStyle(LEVEL_COLORS[level])} />
    </Tooltip>
  )
}

/**
 * One day cell's visual: a bordered square. Level 0 keeps the light fill at
 * full opacity so empty days are still clearly visible, while level 1+ get a
 * solid color. The shared border makes every cell read as a grid square.
 */
function cellBaseStyle(background: string): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    aspectRatio: '1',
    borderRadius: 2,
    background,
    border: '1px solid var(--dsw-alias-border-l1)',
    boxSizing: 'border-box',
    cursor: 'pointer',
  }
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
