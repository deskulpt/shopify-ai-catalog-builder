<p align="center">
  <img src="https://img.shields.io/badge/Shopify-Embedded_App-96bf48?style=for-the-badge&logo=shopify&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-Flask_Microservice-3776ab?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/AI-Gemini_•_Claude_•_OpenAI-ff6f00?style=for-the-badge&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/React_Router-v7-ca4245?style=for-the-badge&logo=reactrouter&logoColor=white" />
</p>

# 🧠 Product Ingest AI — Shopify AI Catalog Builder

> **Turn any vendor website, PDF catalog, or product URL into draft Shopify products — complete with variants, metafields, images, and collections — in minutes, not days.**

Product Ingest AI is an embedded Shopify app that crawls vendor websites, scrapes product data, extracts structured fields using AI, and publishes them directly to your Shopify store. It handles the entire product data pipeline from raw HTML/PDF sources through AI-powered extraction to Shopify Admin API mutations.

---

## ✨ Features

### 🕷️ Intelligent Web Crawling
- **Sitemap & robots.txt discovery** — auto-detects site structure, categories, and product URLs
- **Domain-agnostic extraction** — works with any e-commerce website, no per-site configuration needed
- **Schema.org / JSON-LD parsing** — leverages structured data when available on product pages
- **Playwright-rendered DOM** — handles JavaScript-heavy SPAs and dynamic product pages

### 🤖 AI-Powered Product Extraction
- **Multi-provider AI** — supports Gemini, Claude (Anthropic), and OpenAI/OpenRouter
- **Auto-template generation** — learns extraction rules from sample product pages
- **Tab & accordion metafield extraction** — scrapes product tabs (Details, How To Use, Ingredients, etc.) into Shopify metafields
- **Variant detection** — identifies size/color/material options and creates proper Shopify variant structures
- **Multi-product splitting** — detects and separates bundled product pages into individual drafts

### 📄 Document Ingestion
- **PDF catalog parsing** — pattern-based extraction with AI fallback for complex layouts
- **MarkItDown conversion** — converts PDF, DOCX, XLSX, PPTX, HTML, and images to structured Markdown
- **Completeness scoring** — flags missing fields and rates extraction quality (0–100)

### 🏗️ Schema Mapping & Blueprints
- **Multi-example schema generation** — combine multiple sample URLs to build a comprehensive extraction blueprint
- **Discovered attribute survey** — interactive UI to select/ignore specific attributes before import
- **Vendor profile system** — save domain-specific extraction schemas for reuse across product lines

### 📦 Shopify Integration
- **Draft product creation** — title, description (HTML), images, variants, pricing, SKU, barcode
- **Custom metafield definitions** — auto-creates `custom.*` metafield definitions when they don't exist
- **Collection matching** — suggests existing collections or creates new ones based on extracted categories
- **Bulk queue & publish** — queue multiple products, review inline, and publish in batch
- **Purchase type tagging** — identifies direct-buy vs. quote-only products

### 🖥️ Polaris Admin UI
- **Full-width embedded app** — native Shopify admin experience with Polaris components
- **5-step workflow** — Add Profile → Crawl → Schema Map → Queue → Publish
- **Inline review & edit** — preview extracted data, edit fields, toggle variants before publishing
- **Real-time crawl console** — live progress logs during website crawling
- **Help & Documentation** — built-in docs, keyboard shortcuts, and support page

---

## 🏛️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Shopify Admin (Embedded)                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  React Router v7 + Polaris UI                      │  │
│  │  • app._index.tsx (main workspace — 282KB)         │  │
│  │  • app.settings.tsx (AI keys, PDF config)          │  │
│  │  • app.help.tsx (docs & support)                   │  │
│  │  • api.*.tsx (12 server-side API routes)            │  │
│  └────────────┬───────────────────────────────────────┘  │
│               │ fetch()                                   │
│  ┌────────────▼───────────────────────────────────────┐  │
│  │  Node.js Backend (Shopify Auth + Orchestration)    │  │
│  │  • Prisma ORM (SQLite dev / PostgreSQL prod)       │  │
│  │  • Shopify Admin GraphQL API mutations             │  │
│  │  • Session management                              │  │
│  └────────────┬───────────────────────────────────────┘  │
└───────────────┼──────────────────────────────────────────┘
                │ HTTP
┌───────────────▼──────────────────────────────────────────┐
│  Python Flask Microservice (port 5005)                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  markitdown_service.py (124KB — core engine)      │    │
│  │  • /extract — AI product extraction               │    │
│  │  • /generate-schema — multi-URL schema builder    │    │
│  │  • /crawl — sitemap/robots.txt discovery           │    │
│  │  • /convert — MarkItDown file conversion           │    │
│  │  • /pdf-extract — catalog PDF parsing              │    │
│  │  • /health — service status                        │    │
│  ├──────────────────────────────────────────────────┤    │
│  │  auto_template.py — Gemini template generation    │    │
│  │  catalog_pdf_parser.py — pattern-based PDF parse  │    │
│  │  advanced_pdf_parser.py — AI fallback (Claude)    │    │
│  │  moa_extraction.py — mixture-of-agents extraction │    │
│  └──────────────────────────────────────────────────┘    │
│  External: Gemini API · Claude API · OpenAI/OpenRouter   │
└──────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.19 |
| Python | ≥ 3.10 |
| npm | ≥ 9 |
| Shopify CLI | ≥ 4.x |
| Shopify Partner Account | [partners.shopify.com](https://partners.shopify.com) |

### 1. Clone & Install

```bash
git clone https://github.com/deskulpt/shopify-ai-catalog-builder.git
cd shopify-ai-catalog-builder

# Node dependencies
npm install

# Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Create .env in project root
cp .env.example .env
```

Required environment variables:

```env
# At least one AI provider key is required
GEMINI_API_KEY=your_gemini_api_key

# Optional — for AI fallback and advanced extraction
OPENROUTER_API_KEY=your_openrouter_key
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### 3. Start Development Servers

**Terminal 1 — Python microservice:**
```bash
source .venv/bin/activate
python services/markitdown_service.py
# → Running on http://localhost:5005
```

**Terminal 2 — Shopify app:**
```bash
npm run dev
# → Opens embedded app in Shopify admin
```

### 4. Open in Shopify Admin

The Shopify CLI will provide a URL like:
```
https://admin.shopify.com/store/YOUR_STORE/apps/product-ingest-ai
```

---

## 📋 Workflow

```
1. ADD PROFILE          2. CRAWL SITE           3. SCHEMA MAP
┌─────────────┐        ┌─────────────┐        ┌─────────────┐
│ Enter vendor │───────▶│ Discover    │───────▶│ Generate    │
│ website URL  │        │ categories  │        │ extraction  │
│ + name       │        │ & products  │        │ blueprint   │
└─────────────┘        └─────────────┘        └─────────────┘
                                                     │
        ┌────────────────────────────────────────────┘
        ▼
4. QUEUE & REVIEW              5. PUBLISH
┌──────────────────┐        ┌─────────────────┐
│ Extract products │───────▶│ Create products  │
│ AI-powered parse │        │ in Shopify with  │
│ Review & edit    │        │ variants, meta-  │
│ inline           │        │ fields, images   │
└──────────────────┘        └─────────────────┘
```

---

## 🔌 API Reference

### Python Microservice (Flask — port 5005)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/extract` | Extract product data from a URL using AI |
| `POST` | `/generate-schema` | Generate extraction blueprint from sample URLs |
| `POST` | `/crawl` | Crawl a domain for sitemap, categories, and product URLs |
| `POST` | `/convert` | Convert uploaded file (PDF/DOCX/etc.) to Markdown |
| `POST` | `/pdf-extract` | Extract products from a PDF catalog |
| `GET` | `/health` | Service health check with AI provider availability |
| `GET` | `/pdf-config` | Get current PDF extraction configuration |
| `PUT` | `/pdf-config` | Update PDF extraction configuration |

### Shopify App Routes (React Router)

| Route | Description |
|-------|-------------|
| `app._index.tsx` | Main workspace — crawl, extract, queue, publish |
| `app.settings.tsx` | AI provider keys, PDF extraction config |
| `app.help.tsx` | Documentation, keyboard shortcuts, support |
| `api.extract.tsx` | Proxy to Python `/extract` |
| `api.crawl.tsx` | Proxy to Python `/crawl` |
| `api.publish.tsx` | Create products via Shopify Admin GraphQL API |
| `api.collections.tsx` | Fetch/create Shopify collections |
| `api.metafields.tsx` | Create custom metafield definitions |
| `api.profiles.tsx` | CRUD for vendor extraction profiles |
| `api.check-existing.tsx` | Duplicate detection against existing catalog |
| `api.generate-schema.tsx` | Proxy to Python `/generate-schema` |
| `api.group-variants.tsx` | Group extracted items into variant families |

---

## 🧪 Testing

### E2E Test Suites

```bash
# Full pipeline test (crawl → extract → queue → publish)
PYTHONPATH=services .venv/bin/python test_full_pipeline.py

# Multi-site, multi-profile regression matrix
PYTHONPATH=services .venv/bin/python test_multi_site_profiles.py

# Tab metafield extraction & multi-schema generation
PYTHONPATH=services .venv/bin/python test_tab_metafields_and_multi_schema.py

# Basic scraping E2E
PYTHONPATH=services .venv/bin/python test_e2e_scraping.py
```

### Playwright UI Tests

```bash
npx playwright test
```

---

## 🚢 Deployment

### Render (Recommended)

The included `render.yaml` defines a two-service deployment:

| Service | Type | Runtime |
|---------|------|---------|
| `product-ingest-ai-python` | Web Service | Python 3.x |
| `product-ingest-ai-node` | Web Service | Node.js 20.x |

```bash
# Deploy to Shopify
npm run deploy
```

### Environment Variables (Production)

| Variable | Service | Required |
|----------|---------|----------|
| `GEMINI_API_KEY` | Python | ✅ |
| `SHOPIFY_API_KEY` | Node | ✅ |
| `SHOPIFY_API_SECRET` | Node | ✅ |
| `MARKITDOWN_SERVICE_URL` | Node | ✅ |
| `OPENROUTER_API_KEY` | Python | Optional |
| `ANTHROPIC_API_KEY` | Python | Optional |
| `DATABASE_URL` | Node | Production |

---

## 📁 Project Structure

```
shopify-ai-catalog-builder/
├── app/
│   └── routes/
│       ├── app._index.tsx          # Main workspace (282KB)
│       ├── app.settings.tsx        # Settings page
│       ├── app.help.tsx            # Help & documentation
│       ├── app.tsx                 # App shell & navigation
│       ├── api.extract.tsx         # Product extraction proxy
│       ├── api.crawl.tsx           # Crawl proxy
│       ├── api.publish.tsx         # Shopify product creation (19KB)
│       ├── api.collections.tsx     # Collection management
│       ├── api.metafields.tsx      # Metafield definitions
│       ├── api.profiles.tsx        # Vendor profile CRUD
│       └── ...                     # 12 API routes total
├── services/
│   ├── markitdown_service.py       # Flask microservice (124KB)
│   ├── auto_template.py           # Gemini template generation
│   ├── catalog_pdf_parser.py      # Pattern-based PDF parser
│   ├── advanced_pdf_parser.py     # AI-assisted PDF parser
│   ├── moa_extraction.py          # Mixture-of-agents extraction
│   └── pdf_extraction_config.py   # PDF config management
├── prisma/
│   └── schema.prisma              # Database schema
├── extensions/                     # Shopify app extensions
├── e2e/                           # Playwright E2E tests
├── tests/                         # Unit tests
├── render.yaml                    # Render deployment config
├── requirements.txt               # Python dependencies
├── package.json                   # Node dependencies
└── shopify.app.product-ingest-ai.toml  # Shopify app config
```

---

## 🔑 Shopify Scopes

```
write_products
write_metaobject_definitions
write_metaobjects
```

---

## 🤝 Contributing

1. Create a feature branch from `main`
2. Follow the naming convention: `feature/`, `fix/`, `cleanup/`
3. Run E2E tests before pushing
4. Open a PR with a description of changes

---

## 📝 License

Private — © DeSkulpt Inc. All rights reserved.
