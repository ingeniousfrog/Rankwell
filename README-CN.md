# Rankwell

**将网站转化为 SEO 文章选题、内容计划与有据草稿。**

[English](README.md)

Rankwell 是一款**本地优先**的 SEO 内容规划工具。输入公开网站 URL，即可自动构建站点上下文，并输出搜索主题、可配置的编辑日历，以及基于真实页面证据的草稿大纲——全部在本地完成，无需将爬取数据上传至云端规划服务。

AI 生成能力在本地复用 [Codex CLI](https://github.com/openai/codex) 的 OAuth 凭证；未配置时自动回退至确定性规则引擎，保证工作流始终可用。

| | |
| --- | --- |
| **运行环境** | Node.js 18+ · Tauri 2（macOS 桌面版） |
| **AI 提供方** | Codex CLI OAuth（`auth_mode = chatgpt`） |
| **数据驻留** | 本地存储 · 无云端规划后端 |
| **版本** | 0.1.0 · 私有项目 |

---

## 产品定位

传统 SEO 规划工具通常要求你将 URL 粘贴到 SaaS 面板，然后依赖模型对站点的「猜测」。Rankwell 采用相反路径：

1. **先爬取，再生成** — 通过 `robots.txt`、sitemap 与受控同域爬取建立站点认知，再进入规划阶段。
2. **证据驱动** — 草稿引用真实页面 URL、摘录与版位建议，与站点结构对齐。
3. **意图导向规划** — 关键词附带搜索意图、契合度与难度信号；内容日历长度可在 5–30 篇之间配置。
4. **可交付输出** — 支持导出 Markdown、JSON 及可移植项目包，附带 QA 检查、Schema 建议与视觉资产方案。

---

## 核心能力

### 站点洞察

| 能力 | 说明 |
| --- | --- |
| 发现策略 | `robots.txt` → sitemap 索引 → 同域链接爬取 |
| 覆盖报告 | 爬取策略、页面数量、类型、失败记录、参考图与时间线 |
| 安全护栏 | 自动跳过登录、购物车、搜索、结账及常见静态资源路径 |
| 默认限制 | 60 页 · 深度 3 · 12 个 sitemap 文件（`lib/site-context.js`） |

### 内容策略

| 能力 | 说明 |
| --- | --- |
| 规划输入 | 产品品类、目标受众、转化目标、品牌语气 |
| 智能推断 | AI 自动推断，可在高级选项中手动覆盖 |
| 搜索主题 | 候选关键词、问题变体、意图、契合度、难度 |
| 编辑日历 | 滑块控制 5–30 个选题的计划长度 |

### 草稿生产

| 能力 | 说明 |
| --- | --- |
| 有据大纲 | 页面感知型章节结构，附带 `evidenceRefs` 证据引用 |
| 视觉规划 | 资产类型建议、生成规格、参考图与 alt 文案 |
| 质量门禁 | 接地性、URL、Schema、模板契合度、文案质量等 QA 检查 |
| 导出格式 | Markdown · 原始 JSON · 可移植项目包 |

### 本地工作区

| 能力 | 说明 |
| --- | --- |
| 项目持久化 | 工作区保存在浏览器 `localStorage` |
| 跨设备迁移 | JSON 项目包导入/导出 |
| 桌面模式 | Tauri 应用将 Node API 打包为原生 sidecar |

---

## 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│  Rankwell 前端        index.html · app.js · styles.css      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP (127.0.0.1:5279)
┌──────────────────────────────▼──────────────────────────────┐
│  本地 API 服务        server.js                             │
│  ├── 站点爬取         lib/site-context.js · site-discovery  │
│  ├── AI 提示词        lib/ai-prompts.js                     │
│  ├── 草稿流水线       lib/draft-pipeline.js                  │
│  └── 规则回退         client/fallback-workflow.js            │
└──────────────────────────────┬──────────────────────────────┘
                               │ 可选
┌──────────────────────────────▼──────────────────────────────┐
│  Codex CLI OAuth      ~/.codex/auth.json                    │
└─────────────────────────────────────────────────────────────┘

桌面版（Tauri 2）：
  Rankwell.app → 启动 server sidecar → 加载本地 Web UI
```

### 工作流

```text
URL
 └─► robots / sitemap 发现
      └─► 页面爬取 → siteContext
           └─► 规划假设（品类 / 受众 / 目标 / 语气）
                └─► 搜索主题
                     └─► 内容日历（5–30 篇）
                          └─► 草稿大纲 + QA 检查清单
                               └─► 导出（MD / JSON / 项目包）
```

---

## 快速开始

### 环境要求

- **Node.js** 18 及以上（推荐 20+）
- 本机可访问目标网站的**网络连接**
- **可选：** 执行 `codex login`，并在 `~/.codex/auth.json` 中设置 `auth_mode = chatgpt`

### 本地运行

```bash
npm install --cache ./.npm-cache
npm run start
```

在终端打开打印的地址（默认 `http://127.0.0.1:5279/`）。

| 步骤 | 操作 |
| --- | --- |
| 1 | 输入公开网站 URL |
| 2 | 设置计划长度、写作风格或是否生成起始草稿 |
| 3 | 点击 **Analyze with AI** |
| 4 | 审阅站点覆盖、主题、日历、草稿与检查清单 |
| 5 | 导出 Markdown、JSON 或项目包 |

---

## 桌面应用（macOS）

### 开发模式

```bash
npm install --cache ./.npm-cache
npm run tauri:dev
```

### 发布构建

```bash
npm run tauri:build
```

**产物路径：**

```text
src-tauri/target/release/bundle/dmg/Rankwell_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/Rankwell.app
```

桌面版自动启动 bundled Node sidecar，无需单独开终端运行服务。

**额外依赖：** Rust 工具链 · Xcode Command Line Tools

---

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5279` | 本地 HTTP 服务端口 |
| `CODEX_HOME` | `~/.codex` | Codex 配置与认证目录 |
| `AI_MODEL` | Codex 配置或 `gpt-5.5` | 覆盖生成所用模型 |
| `ALLOW_PRIVATE_TARGETS` | 未设置 | 设为 `1` 以允许 localhost / 内网目标 |

```bash
PORT=5280 AI_MODEL=gpt-5.5 npm run start
```

---

## API 参考

基础地址：`http://127.0.0.1:5279`

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `GET` | `/api/provider/status` | Codex 认证状态与当前模型 |
| `POST` | `/api/generate` | 爬取站点并生成完整规划工作区 |
| `POST` | `/api/draft` | 为单个日历条目生成草稿 |

### `POST /api/generate`

```json
{
  "url": "https://example.com",
  "domain": "example.com",
  "category": "",
  "audience": "",
  "goal": "",
  "voice": "",
  "planLength": 14
}
```

- `planLength` — 限制在 **5–30** 之间
- `voice` — `sharp` · `editorial` · `technical` · `friendly` · `founder` · 或留空由 AI 推断

### `POST /api/draft`

```json
{
  "input": { "url": "https://example.com", "domain": "example.com", "planLength": 14 },
  "calendarItem": {
    "day": 1,
    "title": "选题标题",
    "keyword": "目标关键词",
    "intent": "Problem",
    "format": "guide",
    "placement": "blog"
  },
  "existingTitles": []
}
```

### 草稿对象字段

| 字段 | 说明 |
| --- | --- |
| `placement` | 建议的内容版位或页面类型 |
| `placementUrl` | 现有或拟议 URL |
| `visualPlan` | 资产类型、生成规格、参考图、alt 文案 |
| `evidenceRefs` | 用于接地的来源 URL 与摘录 |
| `qaChecks` | 发布前的自动化审阅项 |

---

## 开发与测试

```bash
npm test      # 71 项单元 / 集成测试
npm run check # 服务端与客户端模块语法检查
```

### 目录结构

```text
rankwell/
├── index.html              # Web UI 入口
├── app.js                  # 客户端逻辑
├── server.js               # 本地 API 服务
├── client/                 # UI 模块（导出、项目、工作流）
├── lib/                    # 爬取、AI 提示词、草稿流水线
├── test/                   # Node 测试套件
├── scripts/bundle-server.sh
├── src-tauri/              # Tauri 桌面壳与图标
├── brand-logo.svg
├── package.json
├── README.md
└── README-CN.md
```

---

## 常见问题

<details>
<summary><strong>端口被占用（5279 EADDRINUSE）</strong></summary>

```bash
lsof -i :5279
kill <PID>
# 或换端口
PORT=5280 npm run start
```

</details>

<details>
<summary><strong>AI 生成失败</strong></summary>

1. 访问 `/api/provider/status` 或查看界面中的 Codex 状态面板。
2. 确认 `~/.codex/auth.json` 中 `auth_mode` 为 `chatgpt`。
3. 确认目标网站可访问且返回可爬取的 HTML。

</details>

<details>
<summary><strong>站点爬取失败</strong></summary>

API 将返回 `siteContext.ok: false`，并附带失败详情与爬取时间线。默认禁止本地与内网目标：

```bash
ALLOW_PRIVATE_TARGETS=1 PORT=5280 npm run start
```

</details>

---

<p align="center">
  <sub>Rankwell · 本地优先 SEO 内容规划 · <a href="README.md">English</a></sub>
</p>
