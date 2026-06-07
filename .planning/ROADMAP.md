# Roadmap: Product Ingest AI

## Phases

### 1. Phase 1: Hello World & Service Architecture
**Goal:** Scaffolding the basic services and Shopify connection.
- Set up Dev store and Partner account.
- Scaffold React Router + Node app using Shopify CLI.
- Build Python MarkItDown microservice with Flask.
- Expose the "Hello World" UI in the embedded admin.

### 2. Phase 2: Ingestion & Conversion
**Goal:** Accept files and URLs, crawl websites, and return structured Markdown/site-maps.
- Build drag-and-drop file upload UI using native `<s-drop-zone>`.
- Build URL input UI using `<s-url-field>`.
- Build crawler/discovery backend to parse `robots.txt`, `sitemap.xml`, `llms.txt`, and HTML `schema.org` data.
- Build Polaris Category & Product Selection Tree UI using native Polaris Web Components.
- Node.js routes to handle upload/URL submission and trigger crawling.
- Integration between Node.js and Python MarkItDown service.
- Display raw Markdown preview.

### 3. Phase 3: AI Extraction & Mapping
**Goal:** Parse Markdown and crawled structure into structured JSON, mapping variants and purchase types.
- Implement LLM service layer.
- Prompt engineering for specification extraction, unit normalization.
- Variant and series detection logic.
- Implement industrial product variant/series clustering engine using SKU/name patterns and LLM classification.
- Implement quote-only vs. direct-buy detection logic.
- Metafield Definition creation and matching logic (`shopify-custom-data`).
- Completeness scoring utility.

### 4. Phase 4: Review UI & Shopify Integration
**Goal:** Present drafts, configure custom metafields, and publish to Shopify.
- Build Product Draft review cards using Polaris App Home components.
- Show completeness score, variants, purchase type (`direct_buy` vs `quote_only`), and collection suggestions.
- Handle edits and validation warnings.
- Automatically register required Metafield Definitions (including `custom.purchase_type`) in Shopify prior to product creation.
- Execute optimal Shopify GraphQL mutations (e.g., `productSet`, `productVariantsBulkCreate`) to create products, variants, and metafields.
