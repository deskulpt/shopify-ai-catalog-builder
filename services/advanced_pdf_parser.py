"""
advanced_pdf_parser.py
━━━━━━━━━━━━━━━━━━━━━━━
Advanced parser for complex industrial catalog PDFs with:
  • Column-based variant layouts (multiple SKUs, shared specs)
  • AI-assisted pattern detection (Claude API fallback)
  • Configurable extraction strategies
  • Robust variant grouping and deduplication
"""

import re
import os
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from pypdf import PdfReader

try:
    from anthropic import Anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False
    Anthropic = None

# ─── Column-Based Product Box Parser ───────────────────────────────────────

@dataclass
class VariantSpec:
    """One spec value for one SKU variant."""
    name: str
    value: str
    variant_index: int  # which column this belongs to


@dataclass
class ProductBox:
    """A single product box with multiple SKU variants and shared specs."""
    title: str
    variant_skus: List[str]  # list of SKU strings (one per column)
    specs: List[VariantSpec]  # specs with variant_index
    page: int
    raw_text: str  # original text block

    def to_products(self) -> List[Dict[str, Any]]:
        """Convert box with variants into separate products or variant group."""
        if not self.variant_skus:
            return []

        # Group specs by variant
        variant_specs = {}
        for i in range(len(self.variant_skus)):
            variant_specs[i] = []

        for spec in self.specs:
            if spec.variant_index < len(self.variant_skus):
                variant_specs[spec.variant_index].append({
                    'name': spec.name,
                    'value': spec.value
                })

        products = []
        for idx, sku in enumerate(self.variant_skus):
            products.append({
                'title': self.title,
                'sku': sku,
                'page': self.page,
                'specifications': variant_specs.get(idx, []),
                'variant_group': self.variant_skus,  # track all variants in group
            })

        return products


class ColumnBasedParser:
    """Parse product boxes with column-aligned variant specs."""

    def __init__(self):
        self.skus_per_line_threshold = 0.7  # detect lines with multiple SKUs

    def extract_product_box(self, text_block: str, page: int) -> Optional[ProductBox]:
        """
        Parse a text block (one product box) into structured ProductBox.
        Detects:
        - Title (first heading or significant line)
        - SKU columns (multiple SKUs in a group)
        - Spec rows (label: col1 col2 col3 ... pattern)
        """
        lines = [l.strip() for l in text_block.split('\n') if l.strip()]
        if len(lines) < 3:
            return None

        # Try to detect title (first substantial line)
        title = lines[0]
        if len(title) < 5:
            title = " ".join(lines[:2]) if len(lines) > 1 else "Product"

        # Extract all SKUs from text
        all_skus = self._extract_skus(text_block)
        if not all_skus:
            return None

        # Try to group SKUs by position/context (column detection)
        variant_skus = self._group_sku_variants(all_skus, text_block)
        if not variant_skus:
            variant_skus = [s['sku'] for s in all_skus[:8]]  # limit to 8 variants

        # Extract specs with variant alignment
        specs = self._extract_column_specs(text_block, len(variant_skus))

        return ProductBox(
            title=title,
            variant_skus=variant_skus,
            specs=specs,
            page=page,
            raw_text=text_block
        )

    def _extract_skus(self, text: str) -> List[Dict[str, str]]:
        """Find all SKU patterns in text."""
        # Generic SKU pattern: ABC-123-X or ABC123X
        patterns = [
            r'\b([A-Z]{1,4}\d*-[A-Z]{1,3}\d*(?:-[A-Z0-9]+)*)',  # Type 1: HS5-C8-N04-CP
            r'\b([A-Z]{2,4}-\d{2,4}[A-Z]?)\b',                  # Type 2: PT-100
            r'\b([A-Z]{2,4}\d{2,4}[A-Z]{0,2})\b',               # Type 3: PT100A
        ]

        skus = []
        seen = set()
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                sku = match.group(1)
                if sku not in seen and len(sku) >= 5:
                    skus.append({
                        'sku': sku,
                        'position': match.start(),
                        'context': text[max(0, match.start()-20):match.end()+20]
                    })
                    seen.add(sku)

        return sorted(skus, key=lambda x: x['position'])

    def _group_sku_variants(self, sku_list: List[Dict], text: str) -> List[str]:
        """
        Detect if SKUs are variants of same family (differ only in suffix).
        Returns grouped SKUs if detected, else empty list.
        """
        if len(sku_list) < 2:
            return []

        # Check if SKUs share a common prefix
        skus = [s['sku'] for s in sku_list]

        # Find longest common prefix
        prefix_len = 0
        min_sku_len = min(len(s) for s in skus)
        for i in range(min_sku_len):
            if all(s[i] == skus[0][i] for s in skus):
                prefix_len = i + 1
            else:
                break

        # If prefix is significant, they're variants
        if prefix_len >= 6:  # e.g., "HS5-C8" = 6 chars
            return skus

        return []

    def _extract_column_specs(self, text: str, num_variants: int) -> List[VariantSpec]:
        """
        Extract specs aligned to columns.
        Pattern: "Spec Name: val1    val2    val3"
        """
        lines = [l.strip() for l in text.split('\n')]
        specs = []

        for line in lines:
            if ':' not in line:
                continue

            parts = line.split(':', 1)
            if len(parts) != 2:
                continue

            spec_name = parts[0].strip()
            spec_values = parts[1].strip()

            # Skip noise lines
            if any(x in spec_name.lower() for x in ['sku', 'model', 'image', 'www', 'email']):
                continue

            if len(spec_name) < 3 or len(spec_name) > 50:
                continue

            # Try to split values by whitespace
            value_parts = re.split(r'\s{2,}|\|', spec_values)
            value_parts = [v.strip() for v in value_parts if v.strip()]

            # If we have values, assign to variants
            if value_parts:
                for var_idx in range(num_variants):
                    val = value_parts[var_idx] if var_idx < len(value_parts) else (value_parts[-1] if value_parts else '')
                    if val:
                        specs.append(VariantSpec(
                            name=spec_name,
                            value=val,
                            variant_index=var_idx
                        ))

        return specs


# ─── AI-Assisted Extraction Fallback ───────────────────────────────────────

class AIAssistedExtractor:
    """Use Claude API to extract products from PDFs when pattern-based parsing fails."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('ANTHROPIC_API_KEY')
        self.client = None
        if HAS_ANTHROPIC and self.api_key:
            self.client = Anthropic(api_key=self.api_key)

    def extract_products_from_text(self, markdown_text: str, pdf_name: str = "catalog") -> List[Dict[str, Any]]:
        """
        Use Claude to extract structured products from markdown-converted PDF text.
        Returns list of product dicts with title, sku, specs, variants.
        """
        if not self.client:
            return []

        try:
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4096,
                messages=[{
                    "role": "user",
                    "content": f"""You are a product data extraction specialist.

I've converted a PDF catalog to markdown text. Extract all distinct products with their variants.

For each product:
1. Find the base product title (shared across variants)
2. List all SKU variants (may differ only in suffix like -N04 vs -P04)
3. Extract specifications with values for each variant (if column-based)
4. Group variants that share most specs (same family)

Return JSON array like:
[
  {{
    "title": "Base Product Title",
    "base_sku": "HS5-C8",
    "variants": [
      {{"sku": "HS5-C8-N04-CP", "output": "NPN", "termination": "M12 Connector"}},
      {{"sku": "HS5-C8-P04-CP", "output": "PNP", "termination": "M12 Connector"}}
    ],
    "shared_specs": [
      {{"name": "Operating Voltage", "value": "10-30 VDC"}},
      {{"name": "Sensing Distance", "value": "4 mm"}},
      {{"name": "Housing", "value": "Stainless Steel"}}
    ],
    "variant_specs": [
      {{"sku_index": 0, "name": "Output Type", "value": "NPN"}},
      {{"sku_index": 1, "name": "Output Type", "value": "PNP"}}
    ]
  }}
]

Markdown text to parse:
{markdown_text[:8000]}
"""
                }]
            )

            response_text = message.content[0].text

            # Extract JSON from response
            import json
            json_match = re.search(r'\[[\s\S]*\]', response_text)
            if json_match:
                products = json.loads(json_match.group(0))
                return products

        except Exception as e:
            print(f"AI extraction error: {e}")

        return []

    def detect_pdf_structure(self, markdown_text: str) -> Dict[str, Any]:
        """
        Use Claude to analyze and describe the PDF structure.
        Returns metadata about layout, product grouping, variant patterns.
        """
        if not self.client:
            return {}

        try:
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=2000,
                messages=[{
                    "role": "user",
                    "content": f"""Analyze this product catalog structure:

{markdown_text[:4000]}

Return JSON:
{{
  "layout_type": "column_variants|box_list|table|mixed",
  "has_column_specs": true/false,
  "variant_pattern": "SKU suffix differs by output (N/P), termination, etc.",
  "product_grouping": "One box per product family with variants",
  "estimated_products": 10,
  "estimated_variants_per_product": 4
}}
"""
                }]
            )

            response_text = message.content[0].text
            import json
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                return json.loads(json_match.group(0))
        except Exception as e:
            print(f"Structure detection error: {e}")

        return {}


# ─── Unified Parser ───────────────────────────────────────────────────────

def parse_catalog_with_ai_fallback(pdf_path: str, use_ai: bool = True) -> List[Dict[str, Any]]:
    """
    Parse PDF using both pattern-based and AI-assisted approaches.

    Strategy:
    1. Try fast pattern-based parsing (ColumnBasedParser)
    2. If results are poor quality, use AI extraction as fallback
    3. Merge and deduplicate results
    """
    from catalog_pdf_parser import parse_catalog_pdf_file

    # Step 1: Try fast pattern-based parsing
    products = parse_catalog_pdf_file(pdf_path, max_pages=150)

    # Step 2: Assess quality
    if len(products) > 100 or (products and any(len(p.get('sku', '')) < 3 for p in products[:5])):
        # Quality is poor (too many products or bogus SKUs), try AI
        if use_ai:
            print(f"Pattern parsing produced {len(products)} products (may be duplicates). Trying AI extraction...")

            try:
                from markitdown import MarkItDown
                md = MarkItDown()
                result = md.convert(pdf_path)
                markdown_text = result.text_content

                ai_extractor = AIAssistedExtractor()
                ai_products = ai_extractor.extract_products_from_text(markdown_text, pdf_name=os.path.basename(pdf_path))

                if ai_products and len(ai_products) > 0:
                    print(f"AI extraction produced {len(ai_products)} products")
                    return ai_products
            except Exception as e:
                print(f"AI fallback failed: {e}")

    return products
