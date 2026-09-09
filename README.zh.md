# usage-heatmap

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
外部（out-of-tree）插件：在设置菜单新增一个「Usage」设置项，展示类似
GitHub contributions 的**每日 token 消耗热力图**，以及账户余额与 token
总量汇总。

## 功能

- **每日 token 热力图**：按本地日历聚合每次 LLM 请求的 token 用量
  （input + output + cache-read + cache-write），一格代表一天；空白档与
  4 档固定对数色阶分别使用 GitHub 的明暗模式贡献色板。
- **汇总卡片**：Total balance、全周期 Token 总量。
- **窗口统计**：热力图下方显示最近 N 天的总 token 数。
- **数据跨重启持久化**：每日历史原子写入
  `$DSH_HOME/usage-heatmap/daily-usage.json`（0600 权限），重启不丢失。

> 说明：官方公开 API（`/user/balance`）只返回余额，**不提供 Total Cost**；
> 官网的消费金额来自 platform.deepseek.com 的私有 dashboard 接口，仅浏览器
> 登录会话可访问，API key 无法认证。因此本插件只统计 token 数与余额，
> 不估算金额。

## 架构

| 数据 | 通道 | 说明 |
|---|---|---|
| 每日 token 历史 | **host 聚合 + webserver 路由** | host 监听 `session/event`，把 usage 事件按天折叠、原子持久化；浏览器经 `/usage-heatmap/history` 轮询读取。 |
| 账户余额 | **webserver 路由** | host 周期调用 DeepSeek `GET /user/balance` 并缓存，随 history 路由一并返回。 |

历史是从持久化会话日志和实时 usage 事件构建的账户级物化汇总，余额也是账户级
数据；两者都不属于单个会话 projection，因此由独立 Web 路由提供，且不会向
durable 会话日志写入合成事件。

```
┌─ host (node) ───────────────────────────┐   ┌─ browser ──────────────────┐
│ ctx.on('session/event')                 │   │ settings.section            │
│   usage → DailyUsageStore (按天聚合)     │   │   └─ Usage 页面             │
│     → $DSH_HOME/usage-heatmap/*.json     │   │       ├─ 汇总卡片           │
│ setInterval → GET /user/balance (缓存)   │   │       └─ TokenHeatmap      │
│ webServer /usage-heatmap/history ───────▶│──▶│       (30s 轮询 history)   │
└──────────────────────────────────────────┘   └────────────────────────────┘
```

## 目录结构

```
dsh-usage-heatmap/
├── package.json              # 私有包；dsh.client 声明；exports["./client"]
├── cordis.patch.yml          # bundle 安装时自动挂载 host 半
├── tsconfig.json             # 编辑器类型检查
├── tsconfig.build.json       # 声明文件构建
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

仓库已经提交 host、client 和类型声明构建产物。使用者不需要在插件目录运行
`pnpm install` 或重新构建：

```sh
git clone https://github.com/MoriTang/dsh-usage-heatmap.git
```

从 Harness checkout 注册到 `web` profile：

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/dsh-usage-heatmap
```

`cordis.patch.yml` 会自动挂载 host 半，package manifest 会加载 Web client half。
注册后重启 `pnpm dsh web`。

卸载时运行：

```sh
pnpm dsh plugin --profile web remove dsh-usage-heatmap
```

## 开发

源码开发需要 DeepSeek Harness checkout。把两个仓库放在同一父目录中：

```text
src/
├── deepseek-harness/
└── dsh-usage-heatmap/
```

插件的 DSH 开发依赖通过 `link:../deepseek-harness/...` 使用该 checkout；普通
构建工具来自 npm：

```sh
cd /path/to/dsh-usage-heatmap
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

当前版本面向 DeepSeek Harness `0.1.2-alpha.2` 系列。Harness 尚未发布稳定兼容
承诺，升级 Harness 后应重新运行以上检查并验证 Web UI。

## 配置

bundle 已提供默认配置。需要覆盖时，在 `~/.dsh/profiles/web/cordis.patch.yml`
按 Loader id 添加配置；不要再次使用 `insert`：

```yaml
- id: usage-heatmap
  config:
    apiKeyEnv: 'DEEPSEEK_API_KEY'
    baseURL: 'https://api.deepseek.com'
    refreshMs: 60000
    historyDays: 90
```

保存后配置热加载；刷新浏览器页面，设置菜单即出现「Usage」项。

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | API key 的凭证引用（环境变量名） |
| `baseURL` | `https://api.deepseek.com` | API 端点基址，`/user/balance` 追加其后 |
| `refreshMs` | `60000` | 余额刷新间隔（毫秒） |
| `historyDays` | `365` | 热力图展示的最近天数 |

改动配置保存即热生效（config-only HMR），无需重启。

## 验证

- **history 路由**：`curl http://127.0.0.1:3080/usage-heatmap/history` 应返回
  `{"days":[{date,tokens}...],"totals":{"tokens":...},"balance":{...},"checkedAt":...,"lastError":null}`。
- **client bundle**：`curl http://127.0.0.1:3080/plugins/dsh-usage-heatmap/client.js`
  应返回 200 和 `window.__ModuleLoader__.load({...})`。
- **类型检查**：`pnpm run typecheck`。

## 测试

```sh
cd /path/to/dsh-usage-heatmap
pnpm install
pnpm test
```

11 个用例覆盖 `DailyUsageStore` 的核心不变量：双 usage 事件提取与全字段求和、
模型归因（header 切换/unknown）、同 (turn, step) 替换（含归零清理）、多会话
独立累计、snapshot 排序/截断/拷贝、backfill 水位、`persist:false` 零写入、
`adopt` 拷贝语义、`dispose` 同步落盘 + 重载一致、load 容错。

## 已知限制

- **改 client 源码刷新页面即可，改 host 源码需重启**：web profile 禁用了模块级
  HMR，修改 `src/client/*` 后重新构建并**刷新浏览器页面**即生效；修改 host 半
  （`src/index.ts`、`src/daily-usage.ts`）需重启 `dsh web`。`cordis.patch.yml`
  配置编辑可热重载，无需重启。
- **历史来源**：启动时从持久化 session 日志回填；插件运行期间继续累计实时
  usage 事件。无法读取某个会话时保留上次成功写入的历史文件。
- **余额只读**：只查询展示，不含充值/消费操作；接口失败时保留上次成功值
  并记录 `lastError`。
- **无 Total Cost**：官方 API 不提供消费金额（见顶部说明），本插件有意不
  估算金额，避免与官网账单不符。
- 插件 `name` 必须是**包名**（`dsh-usage-heatmap`），因为 client modules
  按包名扫描 `dsh.client` 声明。
