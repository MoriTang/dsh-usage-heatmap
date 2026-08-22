import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-settings SlotMap merge (settings.section) through
// the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { UsageHeatmapSection } from './UsageHeatmapSection.tsx'

/** Required services: slots (settings.section registration). */
export const inject = ['slots']

/**
 * Browser half: registers a settings section ("Usage") beside General
 * and Models. The page renders a GitHub-style daily token-consumption heat
 * map plus balance/token summary cards, fed by the host's
 * `/usage-heatmap/history` route.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-heatmap',
    order: 20,
    label: 'Usage',
  }, UsageHeatmapSection))
}

export { UsageHeatmapSection }
export type { UsageHeatmapSectionProps } from './UsageHeatmapSection.tsx'
