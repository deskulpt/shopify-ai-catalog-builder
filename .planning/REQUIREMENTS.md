# Requirements: Product Ingest AI

## User Stories

- As a merchant, I want to upload a PDF or enter a URL so I can start extracting product data.
- As a merchant, I want to review the extracted data in a draft card so I can verify its accuracy.
- As a merchant, I want the system to detect product variants so I don't have to manually create each size/color combination.
- As a merchant, I want the system to suggest new collections for a series of products.
- As a merchant, I want to see a completeness score so I know if I need to add more details before publishing.
- As a merchant, I want the app to map extracted specifications to my existing Shopify metafields.
- As a developer, I want a Python MarkItDown service to handle document conversion securely.

## Definition of Done

- App is installable as a custom/embedded app on a Shopify development store.
- Python service exposes `POST /convert` and `POST /convert-url`.
- Node backend proxies requests and orchestrates LLM extraction.
- Extraction accurately returns JSON matching the Product Draft data definitions.
- Review UI displays the draft, variants, and completeness score using native Polaris Web Components (e.g., `<s-page>`, `<s-drop-zone>`).
- Metafield Definitions are automatically created based on extracted specs before assigning values to products.
- Final approval pushes a Product and its Variants using modern Shopify GraphQL Admin API mutations (e.g. `productVariantsBulkCreate`).
- All tests (Unit, Integration, E2E) pass.
