import { memo } from 'react'
import { SummaryCards, TokenHeatmap, formatTokens, useHistory } from './UsageHeatmap.tsx'

/** Props: settings-section owner share (close affordance, unused here). */
export interface UsageHeatmapSectionProps {
  close: () => void
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '8px 0',
}

const blockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const headingStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  margin: 0,
}

const captionStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * Settings section: per-day token consumption heat map (GitHub contributions
 * style) plus balance/token summary cards. Data arrives from the host's
 * `/usage-heatmap/history` route, polled so the page stays live while open.
 */
export const UsageHeatmapSection = memo(function UsageHeatmapSection(_props: UsageHeatmapSectionProps) {
  const payload = useHistory(30_000)

  if (payload === null) return <div style={wrapStyle}><span style={captionStyle}>Loading…</span></div>

  const windowTokens = payload.days.reduce((acc, d) => acc + d.tokens, 0)
  const first = payload.days[0]
  const last = payload.days[payload.days.length - 1]

  return (
    <div style={wrapStyle}>
      <SummaryCards payload={payload} />

      <div style={blockStyle}>
        <h3 style={headingStyle}>Daily token consumption</h3>
        <TokenHeatmap days={payload.days} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={captionStyle}>
            {payload.days.length === 0
              ? 'No usage recorded yet.'
              : `Last ${payload.days.length} days · ${formatTokens(windowTokens)} tokens`}
          </span>
          {first !== undefined && last !== undefined && (
            <span style={captionStyle}>{`${first.date} → ${last.date}`}</span>
          )}
        </div>
      </div>

      {payload.lastError !== null && payload.lastError !== undefined && (
        <span style={captionStyle}>Balance unavailable: {payload.lastError}</span>
      )}
    </div>
  )
})
