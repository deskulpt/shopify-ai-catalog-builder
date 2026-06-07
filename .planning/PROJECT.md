# Product Ingest AI

## What This Is

A Shopify embedded app that allows merchants to ingest URLs or uploaded documents (PDF, DOC/DOCX, HTML), converts them to Markdown using MarkItDown, and extracts structured product data via AI for review and import into Shopify. It solves the problem of slow and inconsistent manual product creation from unstructured source files.

## Core Value

Automate and normalize product data ingestion from diverse formats into structured Shopify drafts to save merchant time and improve catalog accuracy.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Support URL and file upload ingestion (PDF, DOC/DOCX, HTML).
- [ ] Convert source inputs to Markdown via Python MarkItDown microservice.
- [ ] Extract product name, SKU, UPC, images, descriptions, and specs with LLM.
- [ ] Normalize units (e.g. `25KG` -> `value: 25, unit: KG, system: metric`).
- [ ] Detect variant options, product lines/series, and map to Shopify structures.
- [ ] Implement embedded Shopify App shell (React Router + Polaris).
- [ ] Provide review UI with completeness scoring, collection suggestions, and metafield mappings.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- [Multi-language product output] — Future enhancement.
- [Duplicate detection at scale] — Future enhancement.
- [Bundle detection/creation] — Future enhancement.
- [Inventory forecasting] — Future enhancement.

## Context

- The frontend uses the Shopify app scaffold (React Router + Polaris).
- The backend uses Node.js for Shopify auth and API coordination.
- A separate Python microservice runs `markitdown[all]` via Flask to handle file conversions.
- An LLM service processes the Markdown to output structured JSON with product details and source references.
- Test Strategy requires unit testing parser/extractors, integration tests for API flows, and E2E for the full ingest-to-draft loop.

## Constraints

- **Architecture**: Must use embedded app standards (React Router/Polaris) — Shopify recommended practice.
- **Microservices**: Python environment needed for MarkItDown — Python library doesn't easily run in Node natively.
- **Performance**: Must be fast enough for synchronous merchant review workflows.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React Router + Polaris | Shopify's recommended scaffold ensures native look and feel | — Pending |
| Separate Python API for MarkItDown | The `markitdown` package is Python-native and complex to wrap tightly into Node | — Pending |

---
*Last updated: 2026-06-07 after initialization*
