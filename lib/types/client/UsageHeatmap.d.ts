/** One day cell in the history series. */
export interface HistoryDay {
    date: string;
    tokens: number;
    byModel: Record<string, number>;
}
export interface HistoryTotals {
    tokens: number;
}
export interface BalanceInfo {
    currency: 'CNY' | 'USD';
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
}
export interface HistoryPayload {
    days: HistoryDay[];
    totals: HistoryTotals;
    balance: {
        is_available: boolean;
        balance_infos: BalanceInfo[];
    } | null;
    checkedAt: number;
    lastError: string | null;
}
/** Fetch the history route once, then refresh on the given interval. */
export declare function useHistory(intervalMs: number): HistoryPayload | null;
/** Compact token count: 517 / 12.2K / 1.2M. */
export declare function formatTokens(n: number): string;
/**
 * Heat-map grid, GitHub contributions style: one cell per day, rows are
 * weekdays and columns are weeks, with a month label row on top. Color
 * intensity follows fixed logarithmic token buckets; hovering a cell shows
 * its date and exact token count.
 *
 * The grid uses CSS Grid so every column stretches to share the container
 * width — 53 weeks fit one screen with no horizontal scrollbar, regardless of
 * the settings panel width. Cells keep a square shape via `aspect-ratio: 1`.
 *
 * Grid coordinate system (1-based):
 * - column 1 = weekday label gutter, columns 2..N+1 = week columns
 * - row 1 = month label row, rows 2..8 = Sun..Sat
 */
export declare function TokenHeatmap({ days }: {
    days: HistoryDay[];
}): import("react").JSX.Element;
/**
 * Legend matching GitHub contributions: "Less" on the left, the five color
 * swatches, "More" on the right. Each swatch's hover shows its token range.
 */
export declare function HeatmapLegend(): import("react").JSX.Element;
/** Summary card: total balance and whole-history token total. */
export declare function SummaryCards({ payload }: {
    payload: HistoryPayload;
}): import("react").JSX.Element;
//# sourceMappingURL=UsageHeatmap.d.ts.map