# Roadmap: Product Ingest AI

## Overview

Automate and normalize product data ingestion from diverse formats (files, URLs, vendor sites) into structured Shopify draft products using Python-native MarkItDown conversion, crawler structure discovery, and LLM-based extraction.

## Phases

- [x] **Phase 1: Hello World & Service Architecture** - Scaffold React Router + Node app and Python microservice. (completed 2026-06-07)
- [x] **Phase 2: Ingestion & Conversion** - Accept files/URLs, discover vendor site categories/products, and select target content. (completed 2026-06-08)
- [x] **Phase 3: AI Extraction & Mapping** - Run LLM on Markdown, normalize units, group variants, and detect purchase type. (completed 2026-06-08)
- [x] **Phase 4: Review UI & Shopify Integration** - Review drafts, map metafields, and publish to Shopify. (completed 2026-06-30)

## Phase Details

### Phase 1: Hello World & Service Architecture

**Goal**: Scaffold the basic services and Shopify connection.
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):

  1. Embedded Shopify app is installable on a development store.
  2. Frontend renders a basic Hello World home screen.
  3. Node.js backend can ping the Python Flask conversion microservice.

**Plans**: 1 plan

Plans:

- [x] 01-01: Hello World App Scaffolding and Python service connection

### Phase 2: Ingestion & Conversion

**Goal**: Accept files and URLs, crawl websites, and return structured Markdown/site-maps.
**Depends on**: Phase 1
**Success Criteria** (what must be TRUE):

  1. User can drag-and-drop a file (PDF/DOCX) and see a converted Markdown preview.
  2. User can enter a URL and view the converted Markdown preview.
  3. User can input a vendor domain to trigger a crawling process that parses sitemap, robots.txt, llms.txt, and schema.org data.
  4. Polaris UI displays the discovered category taxonomy in a selection tree.

**Plans**: 2 plans

Plans:

- [x] 02-01: Drag-and-drop file upload and URL parsing
- [x] 02-02: Crawler discovery backend and Polaris Category Tree selection UI

### Phase 3: AI Extraction & Mapping

**Goal**: Parse Markdown and crawled structure into structured JSON, mapping variants and purchase types.
**Depends on**: Phase 2
**Success Criteria** (what must be TRUE):

  1. LLM parses the Markdown content into structured product JSON matching the PRD data definitions.
  2. Industrial products are automatically clustered into parent products and variants based on SKU, name, or series matches.
  3. Extraction detects whether a product is direct-buy or quote-only.
  4. Units are successfully normalized (e.g. 25KG -> value: 25, unit: KG).

**Plans**: 2 plans

Plans:

- [x] 03-01: LLM service layer with unit normalization
- [x] 03-02: Industrial product variant clustering and purchase type detection

### Phase 4: Review UI & Shopify Integration

**Goal**: Present drafts, configure custom metafields, and publish to Shopify.
**Depends on**: Phase 3
**Success Criteria** (what must be TRUE):

  1. Review UI displays the product draft, variant matrix, and purchase type using native Polaris Web Components.
  2. App automatically creates required Shopify Metafield Definitions before assigning product metafield values.
  3. Approved products and variants are created in Shopify using efficient GraphQL mutations (e.g. `productVariantsBulkCreate`).

**Plans**: 1 plan

Plans:

- [x] 04-01: Polaris draft review UI and Shopify GraphQL publishing

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Hello World & Service Architecture | 1/1 | Complete    | 2026-06-07 |
| 2. Ingestion & Conversion | 2/2 | Complete    | 2026-06-08 |
| 3. AI Extraction & Mapping | 2/2 | Complete    | 2026-06-08 |
| 4. Review UI & Shopify Integration | 1/1 | Complete    | 2026-06-30 |
