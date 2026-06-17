# Phase 4 Context: Review UI & Shopify Integration

## Purpose
This phase is responsible for presenting the parsed product drafts to the merchant for review, displaying the variant option matrix and purchase types, configuring app-owned metafields, and publishing the approved products to Shopify via the Admin GraphQL API.

## Custom Data Modeling (TOML-defined)
We define the `purchase_type` metafield in `shopify.app.toml` as an app-owned metafield:
- **Namespace:** `$app`
- **Key:** `purchase_type`
- **Type:** `single_line_text_field`
- **Allowed Values:** `direct_buy` | `quote_only`

This metafield is used by theme templates to customize the product page (e.g. hiding the "Add to Cart" button and displaying a "Request a Quote" form for `quote_only` items).

## Publishing GraphQL Flow

### 1. Product & Variants Creation
We will use the Shopify GraphQL mutations `productCreate` and `productVariantsBulkCreate` to create the parent product and all associated variants in a single efficient process.

### 2. Metafield Publishing
We will use the `metafieldsSet` mutation to assign the `purchase_type` value to the newly created product.

```graphql
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
    }
    userErrors {
      field
      message
    }
  }
}
```
**Variables:**
```json
{
  "metafields": [
    {
      "ownerId": "gid://shopify/Product/12345",
      "namespace": "$app",
      "key": "purchase_type",
      "value": "quote_only"
    }
  ]
}
```
