# Roadmap: Product Ingest AI

## Phases

### 1. Phase 1: Hello World & Service Architecture
**Goal:** Scaffolding the basic services and Shopify connection.
- Set up Dev store and Partner account.
- Scaffold React Router + Node app using Shopify CLI.
- Build Python MarkItDown microservice with Flask.
- Expose the "Hello World" UI in the embedded admin.

### 2. Phase 2: Ingestion & Conversion
**Goal:** Accept files and URLs and return Markdown.
- Build drag-and-drop file upload UI.
- Build URL input UI.
- Node.js routes to handle upload/URL submission.
- Integration between Node.js and Python MarkItDown service.
- Display raw Markdown preview.

### 3. Phase 3: AI Extraction & Mapping
**Goal:** Parse Markdown into structured JSON.
- Implement LLM service layer.
- Prompt engineering for specification extraction, unit normalization.
- Variant and series detection logic.
- Metafield matching logic.
- Completeness scoring utility.

### 4. Phase 4: Review UI & Shopify Integration
**Goal:** Present drafts and publish to Shopify.
- Build Product Draft review cards (Polaris).
- Show completeness score, variants, and collection suggestions.
- Handle edits and validation warnings.
- Execute Shopify GraphQL mutations to create products, variants, and metafields.
