import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
export interface Config {
    /** Credential reference (environment-variable name) for the API key. */
    apiKeyEnv: string;
    /** Endpoint base; `/user/balance` is appended. */
    baseURL: string;
    /** Balance refresh interval in milliseconds. */
    refreshMs: number;
    /** Number of recent days the history route returns (heat-map width). */
    historyDays: number;
}
export declare const Config: z.ZodType<Config>;
export declare const name = "usage-heatmap";
export declare const inject: string[];
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
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map