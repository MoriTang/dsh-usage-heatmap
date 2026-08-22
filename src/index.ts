import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'
// Type-only: pulls the webServer Context merge and its WebRoute type.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the timer service mixin (ctx.setInterval) into Context.
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { DailyUsageStore } from './daily-usage.ts'

/** One balance line from the DeepSeek /user/balance response. */
interface BalanceInfo {
  currency: 'CNY' | 'USD'
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

interface BalanceResponse {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

export interface Config {
  /** Credential reference (environment-variable name) for the API key. */
  apiKeyEnv: string
  /** Endpoint base; `/user/balance` is appended. */
  baseURL: string
  /** Balance refresh interval in milliseconds. */
  refreshMs: number
  /** Number of recent days the history route returns (heat-map width). */
  historyDays: number
}

export const Config: z.ZodType<Config> = z.object({
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  baseURL: z.string().default('https://api.deepseek.com'),
  refreshMs: z.number().int().positive().default(60_000),
  historyDays: z.number().int().positive().default(365),
})

export const name = 'usage-heatmap'
export const inject = ['webServer', 'timer', 'credentials', 'sessionPersistence']

function json(res: ServerResponse, value: unknown): void {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value))
}

/**
 * Host half: accumulates per-day token totals persisted under
 * `$DSH_HOME/usage-heatmap/`, queries the DeepSeek account balance, and
 * serves one exact route the browser half reads:
 *
 * - `/usage-heatmap/history` — the recent per-day token series plus the
 *   whole-history token total and the cached account balance.
 *
 * Balance and history are external/global account facts, not session-log
 * folds, so they cannot ride the projection wire (pure event folding) and
 * must not pollute the durable session log with synthetic events.
 */
export function apply(ctx: Context, config: Config): void {
  const ref: CredentialRef = credentialRef(config.apiKeyEnv)

  // Daily history: fold usage-bearing events per local day, persisted with a
  // debounced atomic rewrite. Committed events only — no replay double-count.
  const store = new DailyUsageStore()
  void store.load()

  // Backfill persisted session logs so usage from before this plugin was
  // installed is counted (the live `session/event` firehose only sees events
  // committed after mount). Best-effort: a missing persistence service or a
  // failed read keeps the live counter running on top of the loaded file.
  void (async () => {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) return
    try {
      const sessions = await persistence.list()
      // Logs are authoritative: recompute from scratch, discarding the file.
      store.beginBackfill()
      for (const meta of sessions) {
        try {
          // Skip seed events (fork/resume lineage): their usage belongs to the
          // ancestor session that first produced them, not this child.
          const fromSeq = meta.seedLength ?? 0
          const { events } = await persistence.readFrom(meta.id, fromSeq)
          store.backfill(meta.id, events)
        } catch {
          // Skip a session that fails to read; the live counter still runs.
        }
      }
      await store.dispose() // flush the backfilled totals to disk
    } catch {
      // Listing failure is non-fatal: keep the loaded file + live counter.
    }
  })()

  ctx.on('session/event', (session, event) => {
    store.consume(session, event)
  })
  ctx.effect(() => () => { void store.dispose() }, 'usage-heatmap: daily usage flush')

  // Balance cache + periodic refresh. The route serves whatever the last
  // successful refresh produced; failures keep the previous value and log.
  let balance: BalanceResponse | undefined
  let checkedAt = 0
  let lastError: string | undefined

  const refresh = async (): Promise<void> => {
    try {
      const credentials = ctx.get('credentials')
      let apiKey: string | undefined
      if (credentials !== undefined) {
        const hit = await credentials.resolve(ref)
        apiKey = hit?.value
      } else {
        apiKey = process.env[config.apiKeyEnv]
      }
      if (apiKey === undefined || apiKey.length === 0) {
        lastError = `no API key for ${config.apiKeyEnv}`
        return
      }
      const res = await fetch(`${config.baseURL}/user/balance`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        lastError = `balance fetch failed: HTTP ${res.status}`
        return
      }
      const body = (await res.json()) as BalanceResponse
      balance = body
      checkedAt = Date.now()
      lastError = undefined
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // The timer service's setInterval is an effect: it is cleared when this
  // fiber unloads (config hot-reload, shutdown).
  ctx.setInterval(() => void refresh(), config.refreshMs)

  // Fire one refresh shortly after activation so the route has data fast.
  void refresh()

  const historyHandler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const { days, totals } = store.snapshot(config.historyDays)
    json(res, {
      days,
      totals,
      balance: balance ?? null,
      checkedAt,
      lastError: lastError ?? null,
    })
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/usage-heatmap/history', handler: historyHandler }),
    'usage-heatmap: history route',
  )
}
