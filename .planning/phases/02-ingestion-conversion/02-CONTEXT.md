---
phase: "02"
name: "ingestion-conversion"
created: 2026-06-08
---

# Phase 2: Ingestion & Conversion — Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Accept files and URLs, crawl vendor websites, and return structured Markdown/site-maps.

</domain>

<decisions>
## Implementation Decisions

### Ingestion UI (File & URL Input)
- **Input Placement:** The file upload drop zone and URL input fields will reside in a dedicated "Ingest Source" section at the top of the App Home page.
- **Upload Behavior:** Files (PDF, DOCX, HTML up to 10MB) will be uploaded to a queued list on the Home page without redirecting, allowing the merchant to manage files and run bulk processing later.
- **Markdown Preview & Editing:**
  - An editable Markdown text area will be provided so merchants can correct formatting and text before running AI extraction.
  - The preview will show a sample mapping including: product title, name, SKU, price, image, specifications and values, technical drawing, variant options, and variant option values.
  - Once approved, this corrected schema format will be applied to all subsequent products imported from that domain.
  - For multi-product PDFs, the parser will identify at least the 1st product first and offer the merchant an option to identify more products or scrape the full document.

### Web Crawler Discovery Engine
- **Crawl Depth & Limit:** Maximum depth of 3 levels (Homepage -> Category lists -> Product pages) and a limit of 150 discovered URLs during initial scan.
- **Robots.txt Compliance:** Strictly respect `robots.txt` disallows and `Crawl-delay` settings by default, with a warning and manual override/bypass option for the merchant.
- **Sitemap Missing Fallback:** Fall back to parsing navigation links and HTML tags looking for `llms.txt`, schema.org, and standard product/category URL patterns (e.g. `/products/`, `/collections/`).

### Polaris Category Tree UI
- **Tree Display Format:** A collapsible hierarchical tree view displaying checkboxes, category names, and product counts (e.g., `[ ] Pumps (42 products)`).
- **Selection Granularity:** Allow selecting entire categories (implicitly selecting all nested products) or expanding categories to select/unselect individual products.

### the agent's Discretion
- The executor has discretion on the visual tree styling and exact crawler request libraries.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/routes/app._index.tsx` - Employs Polaris Web Components (`s-page`, `s-button`, `s-section`, `s-stack`, etc.) which will be used for building the Ingestion UI.

### Established Patterns
- Node.js backend proxies requests to `services/markitdown_service.py` on port 5005.

### Integration Points
- Add file upload, domain crawler, and category selection endpoints in the Node.js backend.
- Embed the selection tree directly inside the home route.

</code_context>

<specifics>
## Specific Ideas

- Check for `llms.txt` during crawlers to see if the target vendor site has dedicated scrapable documentation summaries.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>
