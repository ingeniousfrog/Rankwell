# Rankwell

**Turn a website into SEO article ideas, content plans, and grounded drafts.**

[中文文档](README-CN.md)

Rankwell is a local-first SEO content planning application. Point it at a public website, and it builds a structured understanding of that site—then produces search themes, a configurable editorial calendar, and evidence-backed draft outlines you can review before publishing.

Your crawl data and generated workspaces stay on your machine. AI-assisted generation reuses local [Codex CLI](https://github.com/openai/codex) OAuth when available; otherwise Rankwell falls back to deterministic rules so the workflow remains usable offline.

| | |
| --- | --- |
| **Runtime** | Node.js 18+ · Tauri 2 (macOS desktop) |
| **AI provider** | Codex CLI OAuth (`auth_mode = chatgpt`) |
| **Data residency** | Local storage · no cloud planner backend |
| **License** | Private · version 0.1.0 |

---

## Why Rankwell

Most SEO planning tools ask you to paste a URL into a SaaS dashboard and hope the model understood your site. Rankwell takes the opposite approach:

1. **Crawl first** — Discover pages through `robots.txt`, sitemaps, and controlled same-origin crawling before any generation step.
2. **Ground in evidence** — Drafts reference real page URLs, excerpts, and placement suggestions tied to your site structure.
3. **Plan with intent** — Keywords are mapped with search intent, fit, and difficulty; the content calendar length is configurable (5–30 topics).
4. **Ship review-ready output** — Export Markdown, JSON, or a portable project package with QA checks, schema hints, and visual asset plans.

---

## Capabilities

### Site intelligence

| Capability | Detail |
| --- | --- |
| Discovery | `robots.txt` → sitemap indexes → same-origin link crawl |
| Coverage report | Strategy, page counts, types, failures, reference images, timeline |
| Guardrails | Skips login, cart, search, checkout, and common static assets |
| Limits | 60 pages · depth 3 · 12 sitemap files (`lib/site-context.js`) |

### Content strategy

| Capability | Detail |
| --- | --- |
| Planning inputs | Product category, audience, conversion goal, brand voice |
| Inference | AI-inferred defaults with manual override in Advanced options |
| Search themes | Keyword candidates, question variants, intent, fit, difficulty |
| Editorial plan | Slider-controlled calendar from 5 to 30 topics |

### Draft production

| Capability | Detail |
| --- | --- |
| Grounded outlines | Page-aware sections with `evidenceRefs` from crawled content |
| Visual planning | Asset recommendations, prompts/specs, references, alt text |
| Quality gates | QA checks for grounding, URLs, schema, template fit, copy quality |
| Export | Markdown · raw JSON · portable project package |

### Local workspace

| Capability | Detail |
| --- | --- |
| Persistence | Projects saved in browser `localStorage` |
| Portability | Import/export JSON packages between machines |
| Desktop mode | Tauri app bundles the Node API as a native sidecar |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Rankwell UI          index.html · app.js · styles.css      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP (127.0.0.1:5279)
┌──────────────────────────────▼──────────────────────────────┐
│  Local API server     server.js                               │
│  ├── Site crawl       lib/site-context.js · site-discovery.js │
│  ├── AI prompts       lib/ai-prompts.js                       │
│  ├── Draft pipeline   lib/draft-pipeline.js                   │
│  └── Fallback rules   client/fallback-workflow.js             │
└──────────────────────────────┬──────────────────────────────┘
                               │ optional
┌──────────────────────────────▼──────────────────────────────┐
│  Codex CLI OAuth      ~/.codex/auth.json                    │
└─────────────────────────────────────────────────────────────┘

Desktop build (Tauri 2):
  Rankwell.app → spawns server sidecar → loads local web UI
```

### Workflow

```text
URL
 └─► robots / sitemap discovery
      └─► page crawl → siteContext
           └─► planning assumptions
                └─► search themes
                     └─► content calendar (5–30 topics)
                          └─► draft outline + QA checklist
                               └─► export (MD / JSON / package)
```

---

## Quick start

### Prerequisites

- **Node.js** 18 or later (20+ recommended)
- **Network** access to the target website from your machine
- **Optional:** `codex login` with `auth_mode = chatgpt` in `~/.codex/auth.json`

### Run locally

```bash
npm install --cache ./.npm-cache
npm run start
```

Open the URL printed in the terminal (default `http://127.0.0.1:5279/`).

| Step | Action |
| --- | --- |
| 1 | Enter a public website URL |
| 2 | Adjust plan length, writing style, or starter draft in the form |
| 3 | Click **Analyze with AI** |
| 4 | Review site coverage, themes, calendar, draft, and checklist |
| 5 | Export Markdown, JSON, or a project package |

---

## Desktop app (macOS)

### Development

```bash
npm install --cache ./.npm-cache
npm run tauri:dev
```

### Release build

```bash
npm run tauri:build
```

**Output:**

```text
src-tauri/target/release/bundle/dmg/Rankwell_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/Rankwell.app
```

The desktop shell starts the bundled Node sidecar automatically—no separate terminal session required.

**Desktop requirements:** Rust toolchain · Xcode Command Line Tools

---

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5279` | Local HTTP server port |
| `CODEX_HOME` | `~/.codex` | Codex configuration and auth directory |
| `AI_MODEL` | from Codex config or `gpt-5.5` | Model override for generation |
| `ALLOW_PRIVATE_TARGETS` | unset | Set to `1` to allow localhost / private-network targets |

```bash
PORT=5280 AI_MODEL=gpt-5.5 npm run start
```

---

## API reference

Base URL: `http://127.0.0.1:5279`

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/provider/status` | Codex auth status and active model |
| `POST` | `/api/generate` | Crawl site and generate full planning workspace |
| `POST` | `/api/draft` | Generate a single draft for one calendar item |

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

- `planLength` — clamped to **5–30**
- `voice` — `sharp` · `editorial` · `technical` · `friendly` · `founder` · or empty for AI inference

### `POST /api/draft`

```json
{
  "input": { "url": "https://example.com", "domain": "example.com", "planLength": 14 },
  "calendarItem": {
    "day": 1,
    "title": "Topic title",
    "keyword": "target keyword",
    "intent": "Problem",
    "format": "guide",
    "placement": "blog"
  },
  "existingTitles": []
}
```

### Draft object fields

| Field | Description |
| --- | --- |
| `placement` | Recommended content area or page type |
| `placementUrl` | Existing or proposed URL |
| `visualPlan` | Asset type, generation spec, references, alt text |
| `evidenceRefs` | Source URLs and excerpts used for grounding |
| `qaChecks` | Automated review items before publish |

---

## Development

```bash
npm test      # 71 unit / integration tests
npm run check # syntax validation across server + client modules
```

### Repository layout

```text
rankwell/
├── index.html              # Web UI shell
├── app.js                  # Client application logic
├── server.js               # Local API server
├── client/                 # UI modules (export, projects, workflow)
├── lib/                    # Crawl, AI prompts, draft pipeline
├── test/                   # Node test runner suites
├── scripts/bundle-server.sh
├── src-tauri/              # Tauri desktop shell + icons
├── brand-logo.svg
├── package.json
├── README.md
└── README-CN.md
```

---

## Troubleshooting

<details>
<summary><strong>Port already in use (EADDRINUSE on 5279)</strong></summary>

```bash
lsof -i :5279
kill <PID>
# or
PORT=5280 npm run start
```

</details>

<details>
<summary><strong>AI generation fails</strong></summary>

1. Open `/api/provider/status` or check the Codex panel in the UI.
2. Confirm `auth_mode` is `chatgpt` in `~/.codex/auth.json`.
3. Verify the target site is reachable and returns crawlable HTML.

</details>

<details>
<summary><strong>Site crawl fails</strong></summary>

The API returns `siteContext.ok: false` with failure details and a crawl timeline. Local and private-network targets are blocked by default:

```bash
ALLOW_PRIVATE_TARGETS=1 PORT=5280 npm run start
```

</details>

---

<p align="center">
  <sub>Rankwell · Local-first SEO content planning · <a href="README-CN.md">中文文档</a></sub>
</p>
