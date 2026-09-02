# usage-heatmap

An external (out-of-tree) plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It adds a “Usage” item to the settings menu, displaying a **daily token usage
heatmap** similar to GitHub contributions, along with account balance and total
token summaries.

## Features

- **Daily token heatmap**: Aggregates token usage for each LLM request by local
  calendar day (input + output + cache-read + cache-write). Each cell represents
  one day, and higher usage is shown with a darker color (four intensity levels,
  normalized against the peak value for that day).
- **Summary cards**: Total balance and all-time Token total.
- **Window statistics**: Displays the total token count for the most recent N
  days below the heatmap.
- **Persistence across restarts**: Daily history is written atomically to
  `$DSH_HOME/usage-heatmap/daily-usage.json` (with 0600 permissions), so data is
  preserved across restarts.

> Note: The official public API (`/user/balance`) returns only the balance and
> **does not provide Total Cost**. The spending amount shown on the official site
> comes from a private dashboard API on platform.deepseek.com, which is accessible
> only to authenticated browser sessions and does not support API key authentication.
> This plugin therefore tracks only token counts and balance; it does not estimate
> monetary cost.

## Architecture

| Data | Channel | Description |
|---|---|---|
| Daily token history | **host aggregation + webserver route** | The host listens for `session/event`, folds usage events by day, and persists them atomically. The browser polls `/usage-heatmap/history` to retrieve the data. |
| Account balance | **webserver route** | The host periodically calls DeepSeek `GET /user/balance` and caches the result, which is returned together with history by the route. |

History and balance are global account-level facts rather than folds of session
logs, so they do not pass through projection (pure event folding) or contaminate
the durable session log.

```
┌─ host (node) ───────────────────────────┐   ┌─ browser ──────────────────┐
│ ctx.on('session/event')                 │   │ settings.section            │
│   usage → DailyUsageStore (daily rollup)│   │   └─ Usage page             │
│     → $DSH_HOME/usage-heatmap/*.json    │   │       ├─ Summary cards      │
│ setInterval → GET /user/balance (cache) │   │       └─ TokenHeatmap       │
│ webServer /usage-heatmap/history ───────▶│──▶│       (30s history polling) │
└──────────────────────────────────────────┘   └────────────────────────────┘
```

## Directory Structure

```
plugins/usage-heatmap/
├── package.json              # Private package; dsh.client declaration; exports["./client"]
├── tsconfig.json             # Editor type checking
├── build.mjs                 # esbuild builds the host bundle + client bundle
├── src/
│   ├── index.ts              # host half: daily aggregation + balance query + history route
│   ├── daily-usage.ts        # DailyUsageStore: daily aggregation + atomic persistence
│   └── client/
│       ├── index.ts          # client half: settings.section registration
│       ├── UsageHeatmap.tsx  # Heatmap + summary cards + useHistory hook
│       └── UsageHeatmapSection.tsx  # Settings page component
└── lib/                      # Build artifacts (committed to the repository)
```

## Installation

The `@deepseek-ai/*` dependencies use `link:` to reference the local harness
checkout (`../../../deepseek-harness`) because the workspace packages are not
published to the registry.

### 1. Build the artifacts (the client bundle must already be built)

```sh
cd plugins/usage-heatmap
pnpm install          # Materialize link:-ed dependencies
node build.mjs        # Generate lib/index.js + lib/client.js (requires esbuild from the harness)
```

### 2. Install into the web profile

```sh
# Run from the harness checkout
cd <harness-checkout>   # e.g. ../deepseek-harness (sibling of this repo)
pnpm dsh plugin --profile web add <this-repo>/plugins/usage-heatmap
```

### 3. Mount the plugin

Append the following to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: usage-heatmap
      name: 'dsh-usage-heatmap'
      config:
        apiKeyEnv: 'DEEPSEEK_API_KEY'
        baseURL: 'https://api.deepseek.com'
        refreshMs: 60000
        historyDays: 90
```

After saving, the host half is hot-reloaded. Refresh the browser, and the “Usage”
item will appear in the settings menu.

## Configuration

| Field | Default | Description |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference for the API key (environment variable name) |
| `baseURL` | `https://api.deepseek.com` | Base URL of the API endpoint; `/user/balance` is appended to it |
| `refreshMs` | `60000` | Balance refresh interval in milliseconds |
| `historyDays` | `90` | Number of recent days displayed in the heatmap |

Configuration changes take effect immediately after saving (config-only HMR),
without a restart.

## Verification

- **history route**: `curl http://127.0.0.1:3080/usage-heatmap/history` should
  return `{"days":[{date,tokens}...],"totals":{"tokens":...},"balance":{...},"checkedAt":...,"lastError":null}`.
- **client bundle**: `curl http://127.0.0.1:3080/plugins/dsh-usage-heatmap/client.js`
  should return HTTP 200 and `window.__ModuleLoader__.load({...})`.
- **Type checking**: `cd plugins/usage-heatmap && pnpm exec tsc --noEmit`.

## Known Limitations

- **Refresh the page after changing client source code; restart after changing
  host source code**: The web profile disables module-level HMR. After modifying
  `src/client/*`, rebuild and **refresh the browser** for the changes to take
  effect. Changes to the host half (`src/index.ts`, `src/daily-usage.ts`) require
  restarting `dsh web`. Edits to the `cordis.patch.yml` configuration are
  hot-reloaded and do not require a restart.
- **History accumulates only after the plugin is enabled**: Only usage events
  submitted while the plugin is mounted are recorded. Existing history files are
  loaded at startup, but sessions created before the plugin was enabled are not
  backfilled.
- **Read-only balance**: The balance is queried only for display; no top-up or
  spending operations are included. If the API request fails, the last successful
  value is retained and `lastError` is recorded.
- **No Total Cost**: The official API does not provide a spending amount (see the
  note above). This plugin deliberately avoids estimating monetary cost to prevent
  discrepancies with official billing.
- The plugin `name` must be the **package name** (`dsh-usage-heatmap`) because
  client modules scan `dsh.client` declarations by package name.

## Next Steps

- [Add a settings card](https://deepseek-harness.github.io/docs/cookbook/adding-a-settings-card)
- [Package and install](https://deepseek-harness.github.io/docs/user/develop/basic/publish)
