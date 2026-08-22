# usage-heatmap

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
外部（out-of-tree）插件：在设置菜单新增一个「Usage & Cost」设置项，
展示类似 GitHub contributions 的**每日 token 消耗热力图**，以及账户
余额与消耗成本汇总。

## 功能

- **每日 token 热力图**：按本地日历聚合每次 LLM 请求的 token 用量
  （input + output + cache-read + cache-write），一格代表一天，消耗越多
  颜色越深（4 档色阶，与当日峰值归一化）。
- **汇总卡片**：Topped-up balance、Total balance、全周期 Total cost、
  全周期 Token 总量。
- **窗口统计**：热力图下方显示最近 N 天的总 token 数与总成本。
- **数据跨重启持久化**：每日历史原子写入
  `$DSH_HOME/usage-heatmap/daily-usage.json`（0600 权限），重启不丢失。

## 架构

| 数据 | 通道 | 说明 |
|---|---|---|
| 每日 token/cost 历史 | **host 聚合 + webserver 路由** | host 监听 `session/event`，把 usage 事件按天折叠、原子持久化；浏览器经 `/usage-heatmap/history` 轮询读取。 |
| 账户余额 | **webserver 路由** | host 周期调用 DeepSeek `GET /user/balance` 并缓存，随 history 路由一并返回。 |

历史与余额都是全局账户事实，不是会话日志折叠，因此不走 projection
（纯事件折叠），也不污染 durable 会话日志。

```
┌─ host (node) ───────────────────────────┐   ┌─ browser ──────────────────┐
│ ctx.on('session/event')                 │   │ settings.section            │
│   usage → DailyUsageStore (按天聚合)     │   │   └─ Usage & Cost 页面      │
│     → $DSH_HOME/usage-heatmap/*.json     │   │       ├─ 汇总卡片           │
│ setInterval → GET /user/balance (缓存)   │   │       └─ TokenHeatmap      │
│ webServer /usage-heatmap/history ───────▶│──▶│       (30s 轮询 history)   │
└──────────────────────────────────────────┘   └────────────────────────────┘
```

## 目录结构

```
plugins/usage-heatmap/
├── package.json              # 私有包；dsh.client 声明；exports["./client"]
├── tsconfig.json             # 编辑器类型检查
├── build.mjs                 # esbuild 构建 host bundle + client bundle
├── src/
│   ├── index.ts              # host 半：每日聚合 + 余额查询 + history 路由
│   ├── daily-usage.ts        # DailyUsageStore：按天聚合 + 原子持久化
│   └── client/
│       ├── index.ts          # client 半：settings.section 注册
│       ├── UsageHeatmap.tsx  # 热力图 + 汇总卡片 + useHistory hook
│       └── UsageHeatmapSection.tsx  # 设置页组件
└── lib/                      # 构建产物（随仓库提交）
```

## 安装

`@deepseek-ai/*` 依赖通过 `link:` 指向本地 harness checkout
（`../../../deepseek-harness`）—— 工作区包不发布到 registry。

### 1. 构建产物（client bundle 必须已构建）

```sh
cd plugins/usage-heatmap
pnpm install          # 物化 link:-ed 依赖
node build.mjs        # 生成 lib/index.js + lib/client.js（需要 harness 内的 esbuild）
```

### 2. 安装到 web profile

```sh
# 从 harness checkout 运行
cd /Users/mori/src/deepseek-harness
pnpm dsh plugin --profile web add /Users/mori/src/dsh/plugins/usage-heatmap
```

### 3. 挂载

在 `~/.dsh/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: usage-heatmap
      name: 'dsh-usage-heatmap'
      config:
        currency: '¥'
        apiKeyEnv: 'DEEPSEEK_API_KEY'
        baseURL: 'https://api.deepseek.com'
        refreshMs: 60000
        historyDays: 90
        pricing:
          inputPerM: 2
          outputPerM: 8
          cacheReadPerM: 0.5
          cacheWritePerM: 2
```

保存后 host 半热加载；刷新浏览器页面，设置菜单即出现「Usage & Cost」项。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `pricing.inputPerM` | `2` | 未缓存输入，每百万 token 价格（`currency` 单位） |
| `pricing.outputPerM` | `8` | 输出，每百万 token 价格 |
| `pricing.cacheReadPerM` | `0.5` | 缓存命中读取，每百万 token 价格 |
| `pricing.cacheWritePerM` | `2` | 缓存写入，每百万 token 价格 |
| `currency` | `¥` | 价格与显示使用的货币符号 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | API key 的凭证引用（环境变量名） |
| `baseURL` | `https://api.deepseek.com` | API 端点基址，`/user/balance` 追加其后 |
| `refreshMs` | `60000` | 余额刷新间隔（毫秒） |
| `historyDays` | `90` | 热力图展示的最近天数 |

价格表请对照 DeepSeek 当前官方价目调整；改配置保存即热生效（host 半）。

## 验证

- **history 路由**：`curl http://127.0.0.1:3080/usage-heatmap/history` 应返回
  `{"days":[{date,tokens,cost}...],"totals":{...},"currency":"¥","balance":{...},"checkedAt":...,"lastError":null}`。
- **client bundle**：`curl http://127.0.0.1:3080/plugins/dsh-usage-heatmap/client.js`
  应返回 200 和 `window.__ModuleLoader__.load({...})`。
- **类型检查**：`cd plugins/usage-heatmap && pnpm exec tsc --noEmit`。

## 已知限制

- **改 client 源码需重启**：web profile 禁用了模块级 HMR，修改
  `src/client/*` 后需重启 `dsh web` 并刷新页面；host 半与
  `cordis.patch.yml` 配置编辑可热重载。
- **金额是估算**：单价由 `pricing` 配置决定，按 provider 上报的 token 精确
  计算，但价格本身需随官方价目手动维护；不保证与账单完全一致。
- **历史只从插件启用后累计**：仅记录插件挂载期间提交的 usage 事件；
  已存在的历史文件在启动时加载，但不会回填启用前产生的会话。
- **余额只读**：只查询展示，不含充值/消费操作；接口失败时保留上次成功值
  并记录 `lastError`。
- 插件 `name` 必须是**包名**（`dsh-usage-heatmap`），因为 client modules
  按包名扫描 `dsh.client` 声明。

## 下一步

- [添加设置卡片](https://deepseek-harness.github.io/docs/cookbook/adding-a-settings-card)
- [打包与安装](https://deepseek-harness.github.io/docs/user/develop/basic/publish)
