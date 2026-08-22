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
function formatMoney(cost, currency) {
  if (cost === 0) return `${currency}0`;
  if (cost >= 100) return `${currency}${cost.toFixed(2)}`;
  if (cost >= 1) return `${currency}${cost.toFixed(3)}`;
  const magnitude = Math.floor(Math.log10(cost));
  const digits = 3 - magnitude;
  return `${currency}${cost.toFixed(Math.max(0, digits))}`;
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
function heatLevel(value, max) {
  if (value <= 0) return 0;
  const ratio = max <= 0 ? 0 : value / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
function dayOfWeek(date) {
  return (/* @__PURE__ */ new Date(`${date}T00:00:00`)).getDay();
}
var LEVEL_COLORS = [
  "var(--dsw-alias-fill-l3)",
  "var(--dsw-chart-1, #2f81f7)",
  "var(--dsw-chart-2, #a371f7)",
  "var(--dsw-chart-3, #d29922)",
  "var(--dsw-chart-4, #f85149)"
];
function Cell({ day, level }) {
  const title = day === null ? void 0 : `${day.date} \xB7 ${formatTokens(day.tokens)} tokens \xB7 ${formatMoney(day.cost, "\xA5")}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      title,
      style: {
        width: 11,
        height: 11,
        borderRadius: 2,
        background: LEVEL_COLORS[level],
        opacity: level === 0 ? 0.35 : 1
      }
    }
  );
}
function TokenHeatmap({ days }) {
  const max = (0, import_react.useMemo)(() => days.reduce((acc, d) => Math.max(acc, d.tokens), 0), [days]);
  const weeks = (0, import_react.useMemo)(() => {
    const out = [];
    const first = days[0];
    const pad = first === void 0 ? 0 : dayOfWeek(first.date);
    const padded = [...Array(pad).fill(null), ...days];
    for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7));
    return out;
  }, [days]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", gap: 3, overflowX: "auto", paddingBottom: 4 }, children: weeks.map((week, wi) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: week.map((day, di) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { day, level: day === null ? 0 : heatLevel(day.tokens, max) }, di)) }, wi)) });
}
function SummaryCards({ payload }) {
  const cny = payload.balance?.balance_infos.find((info) => info.currency === "CNY") ?? payload.balance?.balance_infos[0];
  const symbol = cny?.currency === "USD" ? "$" : "\xA5";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryCard, { label: "Total balance", value: cny === void 0 ? "\u2014" : `${symbol}${cny.total_balance}` }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryCard, { label: "Total cost (all time)", value: formatMoney(payload.totals.cost, payload.currency) }),
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
  const windowCost = payload.days.reduce((acc, d) => acc + d.cost, 0);
  const first = payload.days[0];
  const last = payload.days[payload.days.length - 1];
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: wrapStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SummaryCards, { payload }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: blockStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: headingStyle, children: "Daily token consumption" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TokenHeatmap, { days: payload.days }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: captionStyle, children: payload.days.length === 0 ? "No usage recorded yet." : `Last ${payload.days.length} days \xB7 ${formatTokens(windowTokens)} tokens \xB7 ${formatMoney(windowCost, payload.currency)}` }),
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
    label: "Usage & Cost"
  }, UsageHeatmapSection));
}

		return module.exports;
	}
});
