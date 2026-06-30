# Product Ingest AI

## What This Is

A Shopify embedded app that allows merchants to ingest URLs or uploaded documents (PDF, DOC/DOCX, HTML), converts them to Markdown using MarkItDown, and extracts structured product data via AI for review and import into Shopify. It solves the problem of slow and inconsistent manual product creation from unstructured source files.

## Core Value

Automate and normalize product data ingestion from diverse formats into structured Shopify drafts to save merchant time and improve catalog accuracy.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Support URL and file upload ingestion (PDF, DOC/DOCX, HTML).
- [x] Convert source inputs to Markdown via Python MarkItDown microservice.
- [x] Perform logical/AI website crawl and structure discovery (sitemaps, robots.txt, llms.txt, schema.org tags).
- [x] Provide a category/product selection tree UI in the Polaris app interface.
- [x] Extract product name, SKU, UPC, images, descriptions, and specs with LLM.
- [x] Detect and flag purchase type (direct buy vs. quote-only basis).
- [x] Normalize units (e.g. `25KG` -> `value: 25, unit: KG, system: metric`).
- [x] Intelligently cluster and map product variants if SKU, name, or series patterns match.
- [x] Implement embedded Shopify App shell (React Router + Polaris).
- [x] Provide review UI with completeness scoring, collection suggestions, and metafield mappings.

### Active

<!-- Current scope. Building toward these. -->

*(None active — all milestone requirements shipped)*

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- [Multi-language product output] — Future enhancement.
- [Duplicate detection at scale] — Future enhancement.
- [Bundle detection/creation] — Future enhancement.
- [Inventory forecasting] — Future enhancement.
- [Admin Action Extensions] — MVP focuses purely on App Home. Embedding block extensions onto the Products page is deferred.

## Context

- The frontend uses the Shopify app scaffold but implements UI using **native Polaris Web Components** (`<s-page>`, `<s-drop-zone>`) per `shopify-polaris-app-home` standards.
- Metafields are strictly modeled using **Metafield Definitions** per `shopify-custom-data` standards prior to assignment.
- The backend uses Node.js for Shopify auth and orchestrating the latest Admin GraphQL API mutations.
- A separate Python microservice runs `markitdown[all]` via Flask to handle file conversions.
- An LLM service processes the Markdown to output structured JSON with product details and source references.
- Test Strategy requires unit testing parser/extractors, integration tests for API flows, and E2E for the full ingest-to-draft loop.

## Constraints

- **Architecture**: Must use embedded app standards built with Polaris Web Components (`s-*` tags). Legacy `@shopify/polaris` React components are prohibited.
- **Data Modeling**: All custom specifications must have Metafield Definitions generated before applying data to products.
- **Microservices**: Python environment needed for MarkItDown — Python library doesn't easily run in Node natively.
- **Performance**: Must be fast enough for synchronous merchant review workflows.
- **Web Crawling**: Must respect `robots.txt` directives and implement polite rate-limiting/throttling to prevent IP bans.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React Router + Polaris | Shopify's recommended scaffold ensures native look and feel | — Pending |
| Separate Python API for MarkItDown | The `markitdown` package is Python-native and complex to wrap tightly into Node | — Pending |

---
*Last updated: 2026-06-07 after initialization*
