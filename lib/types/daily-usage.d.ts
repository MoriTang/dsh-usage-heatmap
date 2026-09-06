import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
/** One day's totals: grand total plus per-model breakdown. */
export interface DayTotals {
    tokens: number;
    byModel: Record<string, number>;
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
 *
 * An instance created with `persist: false` is a memory-only accumulator: it
 * never writes the history file, so a startup backfill can build a candidate
 * in isolation without racing the live store's flush.
 */
export declare class DailyUsageStore {
    private readonly days;
    private readonly lastContribution;
    private readonly currentModel;
    private readonly backfillMaxSeq;
    private flushTimer;
    private readonly filename;
    private readonly persist;
    constructor(options?: {
        persist?: boolean;
    });
    /**
     * Adopt another store's full state, replacing this instance's. Used at
     * startup to swap in a freshly backfilled accumulator atomically — the
     * persistent store never exposes a half-rebuilt view.
     */
    adopt(other: DailyUsageStore): void;
    /**
     * Highest persisted event seq already backfilled per session. Live events
     * buffered during startup whose seq is at or below this watermark were
     * already folded into the accumulator and must NOT replay (they are not
     * double-counted).
     */
    maxBackfilledSeq(sessionId: SessionId): number;
    /** Load the persisted history (best-effort; a missing/corrupt file starts empty). */
    load(): Promise<void>;
    /** Clear the loaded values before rebuilding from persisted logs. */
    beginBackfill(): void;
    /** Backfill from one persisted session's event log. */
    backfill(sessionId: SessionId, events: readonly SessionEvent[]): void;
    /** Fold one live session event into the store. */
    consume(session: Session, event: SessionEvent): boolean;
    private fold;
    /** Add a signed token delta to one day's grand total and model bucket. */
    private addContribution;
    /** Ordered day list (oldest first) plus the whole-history total. */
    snapshot(limitDays: number): {
        days: Array<{
            date: string;
            tokens: number;
            byModel: Record<string, number>;
        }>;
        totals: {
            tokens: number;
        };
    };
    private scheduleFlush;
    /**
     * Serialized write chain: at most one writeFileAtomic runs at a time, and
     * every queued write snapshots the LATEST memory state when it starts. This
     * prevents an older snapshot from renaming over a newer one when flushes
     * overlap.
     */
    private writeChain;
    private dirty;
    private flush;
    /** Flush any pending write (used before the fiber unloads). */
    dispose(): Promise<void>;
}
//# sourceMappingURL=daily-usage.d.ts.map