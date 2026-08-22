window.__ModuleLoader__.load({
	id: "dsh-usage-heatmap",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  UsageHeatmapSection: () => UsageHeatmapSection,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/UsageHeatmapSection.tsx
var import_react2 = require("react");

// src/client/UsageHeatmap.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
function useHistory(intervalMs) {
  const [payload, setPayload] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/usage-heatmap/history");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPayload(data);
      } catch {
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return payload;
}
function formatTokens(n) {
  if (n < 1e3) return String(n);
  if (n < 1e6) {
    const v2 = n / 1e3;
    return `${v2 >= 100 ? Math.round(v2) : Math.round(v2 * 10) / 10}K`;
  }
  const v = n / 1e6;
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}M`;
}
function formatTokensFull(n) {
  return n.toLocaleString("en-US");
}
function heatLevel(value, max) {
  if (value <= 0) return 0;
  const ratio = max <= 0 ? 0 : value / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
var LEVEL_COLORS = [
  "var(--dsw-alias-fill-l3)",
  "var(--dsw-chart-1, #2f81f7)",
  "var(--dsw-chart-2, #a371f7)",
  "var(--dsw-chart-3, #d29922)",
  "var(--dsw-chart-4, #f85149)"
];
var DAY_MS = 864e5;
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function buildGrid(days, windowDays) {
  const byDate = new Map(days.map((d) => [d.date, d.tokens]));
  const today = startOfDay(/* @__PURE__ */ new Date());
  const start = startOfDay(new Date(today.getTime() - (windowDays - 1) * DAY_MS));
  const startSunday = new Date(start.getTime() - start.getDay() * DAY_MS);
  const cells = [];
  const monthLabels = [];
  const cursor = new Date(startSunday);
  while (cursor.getTime() <= today.getTime()) {
    const index = cells.length;
    if (cursor.getDate() === 1) {
      monthLabels.push({ col: Math.floor(index / 7), label: MONTH_NAMES[cursor.getMonth()] });
    }
    const key = dateKey(cursor);
    cells.push({ date: key, tokens: byDate.get(key) ?? 0, future: false });
    cursor.setDate(cursor.getDate() + 1);
  }
  while (cursor.getDay() !== 0) {
    const key = dateKey(cursor);
    cells.push({ date: key, tokens: 0, future: true });
    cursor.setDate(cursor.getDate() + 1);
  }
  return { cells, monthLabels };
}
function TokenHeatmap({ days }) {
  const max = (0, import_react.useMemo)(() => days.reduce((acc, d) => Math.max(acc, d.tokens), 0), [days]);
  const { cells, monthLabels } = (0, import_react.useMemo)(() => buildGrid(days, 365), [days]);
  const colCount = Math.ceil(cells.length / 7);
  const weekCol = (week) => week + 2;
  const weekdayRow = (weekday) => weekday + 2;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: `30px repeat(${colCount}, minmax(0, 1fr))`,
        gridAutoRows: "auto",
        columnGap: 1,
        rowGap: 1,
        alignItems: "stretch"
      },
      children: [
        monthLabels.map(({ col, label }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            style: {
              gridColumn: `${weekCol(col)} / span 1`,
              gridRow: 1,
              fontSize: 9,
              lineHeight: "12px",
              color: "var(--dsw-alias-label-tertiary)",
              whiteSpace: "nowrap",
              overflow: "hidden"
            },
            children: label
          },
          label
        )),
        WEEKDAY_NAMES.map((name, weekday) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            style: {
              gridColumn: 1,
              gridRow: weekdayRow(weekday),
              fontSize: 8,
              lineHeight: "10px",
              color: "var(--dsw-alias-label-tertiary)",
              alignSelf: "center",
              opacity: weekday % 2 === 1 ? 1 : 0.55
            },
            children: name
          },
          name
        )),
        cells.map((cell, index) => {
          const week = Math.floor(index / 7);
          const weekday = index % 7;
          const level = heatLevel(cell.tokens, max);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { gridColumn: weekCol(week), gridRow: weekdayRow(weekday) }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { cell, level }) }, index);
        })
      ]
    }
  );
}
function Cell({ cell, level }) {
  if (cell === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { display: "block", width: "100%", aspectRatio: "1", borderRadius: 2, background: "transparent" } });
  }
  if (cell.future) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { display: "block", width: "100%", aspectRatio: "1", borderRadius: 2, background: LEVEL_COLORS[0], opacity: 0.35 } });
  }
  const label = `${cell.date} \xB7 ${formatTokensFull(cell.tokens)} tokens`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tooltip, { label, side: "top", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      style: {
        display: "block",
        width: "100%",
        aspectRatio: "1",
        borderRadius: 2,
        background: LEVEL_COLORS[level],
        opacity: level === 0 ? 0.35 : 1,
        cursor: "pointer"
      }
    }
  ) });
}
function SummaryCards({ payload }) {
  const cny = payload.balance?.balance_infos.find((info) => info.currency === "CNY") ?? payload.balance?.balance_infos[0];
  const symbol = cny?.currency === "USD" ? "$" : "\xA5";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryCard, { label: "Total balance", value: cny === void 0 ? "\u2014" : `${symbol}${cny.total_balance}` }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryCard, { label: "Tokens (all time)", value: formatTokens(payload.totals.tokens) })
  ] });
}
function SummaryCard({ label, value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 8,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 4
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
      color: "var(--dsw-alias-label-tertiary)",
      fontSize: 12,
      lineHeight: "18px"
    }, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
      color: "var(--dsw-alias-label-primary)",
      fontSize: 20,
      lineHeight: "28px",
      fontVariantNumeric: "tabular-nums",
      fontFamily: "var(--dsw-font-mono, monospace)"
    }, children: value })
  ] });
}

// src/client/UsageHeatmapSection.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var wrapStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  padding: "8px 0"
};
var blockStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10
};
var headingStyle = {
  fontSize: 13,
  lineHeight: "20px",
  fontWeight: 600,
  color: "var(--dsw-alias-label-primary)",
  margin: 0
};
var captionStyle = {
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-tertiary)"
};
var UsageHeatmapSection = (0, import_react2.memo)(function UsageHeatmapSection2(_props) {
  const payload = useHistory(3e4);
  if (payload === null) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: wrapStyle, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: captionStyle, children: "Loading\u2026" }) });
  const windowTokens = payload.days.reduce((acc, d) => acc + d.tokens, 0);
  const first = payload.days[0];
  const last = payload.days[payload.days.length - 1];
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: wrapStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SummaryCards, { payload }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: blockStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: headingStyle, children: "Daily token consumption" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TokenHeatmap, { days: payload.days }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: captionStyle, children: payload.days.length === 0 ? "No usage recorded yet." : `Last ${payload.days.length} days \xB7 ${formatTokens(windowTokens)} tokens` }),
        first !== void 0 && last !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: captionStyle, children: `${first.date} \u2192 ${last.date}` })
      ] })
    ] }),
    payload.lastError !== null && payload.lastError !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: captionStyle, children: [
      "Balance unavailable: ",
      payload.lastError
    ] })
  ] });
});

// src/client/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "usage-heatmap",
    order: 20,
    label: "Usage"
  }, UsageHeatmapSection));
}

		return module.exports;
	}
});
