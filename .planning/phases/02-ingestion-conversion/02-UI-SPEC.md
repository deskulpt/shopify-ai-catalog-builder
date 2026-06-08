---
phase: "02"
slug: "ingestion-conversion"
status: approved
shadcn_initialized: false
preset: none
created: 2026-06-08
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for the Ingestion & Conversion page. Generated in accordance with Shopify App Home and Polaris Web Components standards.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | Polaris Web Components (`s-*` tags) |
| Icon library | Polaris Icons |
| Font | System UI / Inter (Shopify standard) |

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge padding |
| sm | 8px | Button inline gaps, compact box margins |
| md | 16px | Section card content gaps, standard list margins |
| lg | 24px | Layout columns gaps, page section padding |
| xl | 32px | Outer layout padding, major structural gaps |
| 2xl | 48px | Empty state padding, large layout breaks |
| 3xl | 64px | Page-level spacing |

Exceptions: none

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.4 |
| Label | 12px | 500 | 1.2 |
| Heading | 16px | 600 | 1.3 |
| Display | 20px | 700 | 1.25 |

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f6f6f7` | Page background, app frame |
| Secondary (30%) | `#ffffff` | Section cards, list rows, boxes |
| Accent (10%) | `#008060` | Primary buttons, active check status (Shopify Green) |
| Destructive | `#8e1f0b` | Delete buttons, error badges |

Accent reserved for: Primary action buttons (`s-button`), active category selection badges, and target action CTAs.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | "Start Ingestion" |
| Ingestion CTA | "Scrape Selection" |
| Empty state heading | "No Ingestion Sources Active" |
| Empty state body | "Upload a PDF, HTML, or DOCX product file, or enter a vendor domain URL above to discover sitemaps and structures." |
| Error state | "Failed to scan source: [Reason]. Verify robots.txt or URL accessibility." |
| Destructive confirmation | "Delete Source: Are you sure you want to remove this source from the ingestion queue?" |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| Shopify App Home | `s-page`, `s-section`, `s-button`, `s-card`, `s-box`, `s-stack`, `s-link`, `s-paragraph`, `s-heading`, `s-text` | not required |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-06-08
