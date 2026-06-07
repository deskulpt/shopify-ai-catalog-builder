# Requirements: Product Ingest AI

## User Stories

- As a merchant, I want to upload a PDF or enter a URL so I can start extracting product data.
- As a merchant, I want to review the extracted data in a draft card so I can verify its accuracy.
- As a merchant, I want the system to detect product variants so I don't have to manually create each size/color combination.
- As a merchant, I want the system to suggest new collections for a series of products.
- As a merchant, I want to see a completeness score so I know if I need to add more details before publishing.
- As a merchant, I want the app to map extracted specifications to my existing Shopify metafields.
- As a developer, I want a Python MarkItDown service to handle document conversion securely.
- As a merchant, I want to input a vendor website domain and have the app discover categories, sitemaps, robots.txt, and llms.txt.
- As a merchant, I want a selection UI so I can choose which categories or specific products to crawl and scrape.
- As a merchant, I want quote-only products identified and flagged with a specific metafield definition.
- As a merchant, I want the app to cluster similar industrial products (by SKU pattern, series, or name similarity) as variants under one parent product.

## Definition of Done

- App is installable as a custom/embedded app on a Shopify development store.
- Python service exposes `POST /convert` and `POST /convert-url`.
- Backend supports a crawling/discovery service that parses `robots.txt`, `sitemap.xml`, `llms.txt`, and HTML `schema.org` tags.
- Node backend proxies requests, orchestrates crawler, and coordinates LLM extraction.
- Extraction accurately returns JSON matching the Product Draft data definitions.
- Polaris UI displays a category selection tree and product lists using native Polaris Web Components (e.g. `<s-resource-list>`, `<s-choice-list>`).
- Review UI displays the draft, variants, completeness score, and purchase type (`direct_buy` vs `quote_only`) using native Polaris Web Components.
- Metafield Definitions (including `custom.purchase_type`) are automatically created based on extracted specs before assigning values to products.
- Clustering algorithm groups separate vendor items into a unified parent product with variants when SKU, name, or series matches.
- Final approval pushes a Product and its Variants using modern Shopify GraphQL Admin API mutations (e.g. `productVariantsBulkCreate`).
- All tests (Unit, Integration, E2E) pass.
