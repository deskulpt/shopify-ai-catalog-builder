# Product Ingest AI PRD

## Purpose
Build an embedded Shopify app that lets a merchant ingest URLs or uploaded documents, convert them to Markdown using Microsoft MarkItDown, and then extract structured product data for review and import into Shopify. MarkItDown is a Python utility for converting files and office documents to Markdown, and Shopify recommends building embedded apps with React Router and Polaris. [web:1][web:87][web:66]

## Problem
Merchants receive product data in PDFs, DOC/DOCX, HTML pages, spreadsheets, and image-heavy catalogs, which makes manual product creation slow and inconsistent. The app should normalize those inputs, map them to Shopify data structures, and reduce time spent on catalog setup. [web:1][web:105]

## Primary Users
- Merchants and catalog managers.
- Operators managing product onboarding.
- Developers configuring extraction, mapping, and import rules.

## MVP Scope
- Shopify embedded app shell with a Hello World home screen.
- URL and file upload ingestion.
- MarkItDown conversion to Markdown.
- AI extraction of product fields.
- Product matching to existing catalog structure.
- Variant and series detection.
- Metafield mapping and proposal generation.
- Review screen before publish or staging.

## Core Use Cases
1. **Single product ingest:** Upload a PDF spec sheet and generate a draft product with title, SKU, UPC, descriptions, images, and specs.
2. **Catalog ingest:** Import a multi-page catalog and split it into multiple product drafts.
3. **Series detection:** Recognize a product line and group related items under a shared series or collection.
4. **Variant extraction:** Turn size/color/material options into Shopify variants.
5. **Metafield mapping:** Match extracted specs to existing metafields or create new definitions.
6. **Collection creation:** Suggest new collections when no existing category fits.
7. **Data cleanup:** Flag missing fields and low-completeness products for merchant review.
8. **Bulk import:** Prepare payloads for bulk creation or staged review before publishing.
9. **Duplicate detection:** Detect likely duplicates using SKU, UPC, and name similarity.
10. **Re-ingestion:** Reprocess a source file after rules or models are updated.

## Functional Requirements
### Ingestion
- Accept drag-and-drop uploads.
- Accept URL input.
- Support PDF, DOC/DOCX, and HTML.
- Convert all source inputs to Markdown through MarkItDown. MarkItDown supports file-to-Markdown conversion workflows and CLI-based document processing. [web:1][web:5]

### Extraction
- Extract product name, SKU, UPC, handle, images, descriptions, and specs.
- Normalize units and parse expressions such as `25KG` into structured fields.
- Detect variant options and product line patterns.
- Return structured JSON with source references.

### Shopify Mapping
- Match extracted products against existing products and collections.
- Create proposed new collections.
- Map specs to existing metafields.
- Create new metafield definitions where needed. Shopify discussions and docs around metafields support defining new types and, when necessary, creating new definitions for different structures. [web:97][web:103][web:107]
- Prepare product variant payloads for bulk creation. Shopify provides `productVariantsBulkCreate` for multiple variants on one product. [web:31]

### Review UI
- Show extracted source text.
- Show product draft cards.
- Show completeness score.
- Show collection suggestions.
- Show variant matrix.
- Show metafield mapping proposals.
- Show validation errors and warnings.

## Data Definitions
### Product Draft
- Title.
- SKU.
- UPC.
- Handle.
- Main image.
- Additional images.
- Short description.
- Long description.
- Specifications.
- Variant options.
- Collection matches.
- New collection suggestions.
- Metafield mappings.
- Completeness score.
- Source document references.

### Specification Definition
A specification is a normalized attribute extracted from the source text and stored with:
- `name`
- `rawValue`
- `value`
- `unit`
- `system`
- `metafieldNamespace`
- `metafieldKey`
- `confidence`

### Variant Definition
A variant is an option combination within one product and should include:
- Option names and values.
- SKU.
- Barcode.
- Price.
- Image.
- Variant metafields.
- Parent product reference.

### Series Definition
A series is a logical product family that groups related products that are not variants of each other. It should include:
- Series name.
- Parent theme or line.
- Related product IDs.
- Shared tags.
- Shared metafields.
- Optional collection mapping.

## Unit Handling
The app should parse units from text and split them into standardized components:
- `25KG` → `value: 25`, `unit: KG`, `system: metric`.
- `12 lb` → `value: 12`, `unit: lb`, `system: imperial`.
- `10 x 5 x 3 cm` → separate dimension records.
- `2.5L` → volume record.

## Completeness Scoring
Score each record based on required fields:
- 100: all core fields present.
- 80: one major field missing.
- 60: several fields missing.
- 40: low-confidence extraction.
- 0: unusable source.

## Non-Functional Requirements
- Fast enough for merchant review workflows.
- Secure handling of uploads and temporary files.
- Clear error states and retry behavior.
- Compatible with Shopify embedded admin experience.
- Extensible for AI refinement, billing, and bulk import.

## Architecture
- **Frontend:** Shopify embedded app UI using React Router and Polaris. Shopify’s current app scaffold recommends React Router and Polaris-based UI patterns. [web:87][web:66][web:89]
- **Backend:** Node app for Shopify auth, API calls, and orchestration.
- **Conversion service:** Python MarkItDown microservice.
- **AI service:** LLM-based extraction and refinement layer.
- **Persistence:** Database for upload jobs, parsed drafts, mappings, and user actions.

## Hosting
- Host the Shopify app backend on a persistent HTTPS-capable platform.
- Host the Python conversion service either in the same environment or separately.
- Use environment secrets for Shopify, database, and AI credentials.

## Test Strategy
### Unit Tests
- Test URL ingestion validation.
- Test file upload validation.
- Test MarkItDown response handling.
- Test Markdown-to-JSON extraction.
- Test unit parsing logic.
- Test variant grouping logic.
- Test collection matching logic.
- Test metafield mapping logic.
- Test completeness scoring logic.
- Test error handling and retries.

### Integration Tests
- Test app authentication.
- Test upload-to-conversion flow.
- Test extraction-to-review flow.
- Test variant payload generation.
- Test Shopify API mutation payloads.

### End-to-End Tests
- Upload a sample PDF and verify the draft product view.
- Ingest a URL and verify Markdown preview.
- Create a product with variants and confirm the generated Shopify payload.
- Verify that a source with missing fields surfaces warnings.

## Example Test Cases
### Unit Test: Unit Parser
- Input: `25KG`.
- Expect: `{ value: 25, unit: "KG", system: "metric" }`.

### Unit Test: Variant Split
- Input: sizes `10mm, 12mm` and metals `14K Gold, 18K Gold`.
- Expect: 4 combinations.

### Unit Test: Completeness
- Input missing UPC and image.
- Expect score below 100 and flagged fields.

### Unit Test: Series Detection
- Input product names containing the same line name.
- Expect a shared series ID.

### Unit Test: Metafield Mapping
- Input a spec like `length`.
- Expect mapping to existing metafield or new definition proposal.

## Acceptance Criteria
- User can open the app in Shopify admin.
- User sees a working Hello World screen.
- User can submit a URL or upload a document.
- Document is converted to Markdown.
- Product fields are extracted into structured JSON.
- Variants and series are identified.
- Product drafts show completeness scoring.
- Metafield mappings are proposed.
- Test coverage exists for key parsing and mapping utilities.

## Future Enhancements
- AI copy refinement.
- SEO title and description generation.
- Multi-language product output.
- Duplicate detection at scale.
- Bundle detection and bundle creation.
- Inventory forecasting and purchase planning.
- Billing tiers and usage-based AI credits.
- Bulk import queues and approval workflows.