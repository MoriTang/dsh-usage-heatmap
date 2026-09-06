import type { Context } from '@deepseek-ai/cordis';
import { UsageHeatmapSection } from './UsageHeatmapSection.tsx';
/** Required services: slots (settings.section registration). */
export declare const inject: string[];
/**
 * Browser half: registers a settings section ("Usage") beside General
 * and Models. The page renders a GitHub-style daily token-consumption heat
 * map plus balance/token summary cards, fed by the host's
 * `/usage-heatmap/history` route.
 */
export declare function apply(ctx: Context): void;
export { UsageHeatmapSection };
export type { UsageHeatmapSectionProps } from './UsageHeatmapSection.tsx';
//# sourceMappingURL=index.d.ts.map