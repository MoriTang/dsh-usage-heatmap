/** Props: settings-section owner share (close affordance, unused here). */
export interface UsageHeatmapSectionProps {
    close: () => void;
}
/**
 * Settings section: per-day token consumption heat map (GitHub contributions
 * style) plus balance/token summary cards. Data arrives from the host's
 * `/usage-heatmap/history` route, polled so the page stays live while open.
 */
export declare const UsageHeatmapSection: import("react").MemoExoticComponent<(_props: UsageHeatmapSectionProps) => import("react").JSX.Element>;
//# sourceMappingURL=UsageHeatmapSection.d.ts.map