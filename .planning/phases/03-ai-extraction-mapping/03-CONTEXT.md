# Phase 3 Context: AI Extraction & Mapping

## Purpose
This phase is responsible for taking unstructured Markdown content parsed from files/URLs and extracting structured Shopify product drafts, normalizing their technical units, clustering separate items into single products with variants, and detecting if they are quote-only.

## Constraints
- **API Key Fallback:** If `OPENAI_API_KEY` is not present, the Python service must degrade gracefully to a regex/rule-based parser and normalize units using heuristics, guaranteeing functional UI flows in development.
- **Fuzzy Grouping Rules:** Grouping must handle partial SKU/name matches (e.g. sharing prefixes/series names).
- **Purchase Type:** Quote-only items must be labeled `quote_only` and direct-buy items `direct_buy` based on text indicators (e.g. "Request a Quote", "Price on Request", missing price).

## Core API Interfaces

### 1. `/extract` (POST)
**Request:**
```json
{
  "markdown": "# Centrifugal Pump VG-5HP\nSKU: VG-5HP-24V\nPrice: Request a quote\nSpecifications:\n- Weight: 25KG\n- Size: 10 x 5 cm\n- Voltage: 24V",
  "domain": "pumps.com"
}
```

**Response:**
```json
{
  "success": true,
  "title": "Centrifugal Pump VG-5HP",
  "sku": "VG-5HP-24V",
  "purchase_type": "quote_only",
  "short_description": "Centrifugal Pump VG-5HP with SKU VG-5HP-24V",
  "specifications": [
    {
      "name": "Weight",
      "rawValue": "25KG",
      "value": 25.0,
      "unit": "KG",
      "system": "metric"
    },
    {
      "name": "Voltage",
      "rawValue": "24V",
      "value": 24.0,
      "unit": "V",
      "system": "metric"
    }
  ]
}
```

### 2. `/group-variants` (POST)
**Request:**
A list of extracted items from a crawl category.
**Response:**
A list of grouped products, each containing a title, shared description, variant options list, and variants matrix.
