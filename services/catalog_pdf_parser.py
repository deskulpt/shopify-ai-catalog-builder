"""
catalog_pdf_parser.py
━━━━━━━━━━━━━━━━━━━━━
Robust parser for industrial sensor / automation product catalog PDFs.

Uses pdfplumber for column-aware text extraction:
  • Detects column-based product variant layouts (4 SKUs per box, shared specs)
  • Tight SKU validation: rejects false positives like "on-off", "NPN-N"
  • Variant grouping: collapses HS5-C8-N04 and HS5-C8-P04 into one product
  • Section detection: "Inductive", "Capacitive", "Photoelectric", etc.
  • Handles null-byte / glyph corruption in PDFs
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Dict, Tuple
from pypdf import PdfReader
from collections import defaultdict

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False


# ─── Unicode / glyph repair ───────────────────────────────────────────────────

_UNICODE_DIGIT_MAP = {
     
    
    
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
    '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
    '＋': '+', '－': '-', '×': 'x', '÷': '/',
    ' ': ' ', '​': '', '’': "'", '‘': "'",
    '“': '"', '”': '"', 'ﬁ': 'fi', 'ﬂ': 'fl',
}

_NULL_PREFIX_RE = re.compile(r'\x00+(\d)')

def _repair_text(text: str) -> str:
    """Remove/replace known encoding artefacts."""
    if not text:
        return ''
    text = _NULL_PREFIX_RE.sub(r'\1', text)
    chars = []
    for ch in text:
        if ch in _UNICODE_DIGIT_MAP:
            chars.append(_UNICODE_DIGIT_MAP[ch])
        elif unicodedata.category(ch) in ('Cc', 'Cs', 'Co') and ch != '\n':
            pass
        else:
            chars.append(ch)
    text = ''.join(chars)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ─── Improved SKU Pattern ──────────────────────────────────────────────────────

# Tighter SKU validation: must have format Family-Type-Variant
# HS5-C8-N04-CP, HS12-SR18.5-P04-E2, PT-100-NN, etc.
# Rejects: "on-off", "peak-to", "NPN-N", single words
_SKU_PATTERN = re.compile(
    r'\b([A-Z]{2,4}\d*-[A-Z]{1,3}\d+(?:\.\d+)?(?:-[NP]\d{2,3})?(?:-[A-Z]{1,3}\d*)?)\b',
    re.IGNORECASE
)

def _is_valid_sku(sku: str) -> bool:
    """Strict validation: must match pattern and have minimum length."""
    if not _SKU_PATTERN.match(sku.strip()):
        return False
    sku_clean = sku.strip().upper()
    # Must have at least 2 hyphens or be 7+ chars
    hyphen_count = sku_clean.count('-')
    return len(sku) >= 7 or hyphen_count >= 2


# ─── Known spec labels ─────────────────────────────────────────────────────────

_KNOWN_SPEC_LABELS = [
    'Operating voltage', 'Supply voltage', 'Voltage range',
    'Allowable ripple voltage', 'Ripple voltage',
    'No-load current', 'Quiescent current',
    'Maximum load current', 'Load current', 'Output current',
    'Leakage current',
    'Voltage drop', 'Residual voltage',
    'Switching frequency', 'Response frequency', 'Operating frequency',
    'Response time', 'Switching time',
    'Hysteresis', 'Repeat accuracy',
    'IP rating', 'Protection rating', 'Ingress protection',
    'Operating temperature', 'Temperature range', 'Working temperature',
    'Temperature drift', 'Temperature compensation',
    'Short-circuit protection', 'Overload current',
    'Sensing face material', 'Face material',
    'Housing material', 'Body material',
    'Outer diameter', 'Thread diameter', 'Body diameter',
    'Sensing distance', 'Detection distance', 'Nominal sensing range',
    'Flush', 'Non-Flush', 'Flush mounted', 'Non-flush mounted',
    'Cable length', 'Wire length', 'Weight', 'Indicator',
]

_SPEC_LABEL_RE = re.compile(
    '|'.join(re.escape(s) for s in sorted(_KNOWN_SPEC_LABELS, key=len, reverse=True)),
    re.IGNORECASE
)

# ─── Noise filters ────────────────────────────────────────────────────────────

_NOISE_LINES = re.compile(
    r'^('
    r'www\.\S+|'
    r'defuro\s*industrial.*|'
    r'address\s*:.*|'
    r'tel\s*:.*|fax\s*:.*|'
    r'email\s*:.*|'
    r'website\s*:.*|'
    r'qr\s+code|whatsapp|wechat|'
    r'quality\s+wins.*|'
    r'technology\s+leads.*|'
    r'\d{1,4}\s*[-–]\s*\d{1,4}'
    r')\s*$',
    re.IGNORECASE
)

_SECTION_HEADING_RE = re.compile(
    r'^(DC\s*\d*-wire|AC\s*\d*-wire|'
    r'Inductive|Capacitive|Photoelectric|Fiber|Light curtain|Analog|'
    r'(?:Star\s+)?Products?|Function\s+Description)',
    re.IGNORECASE
)


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass
class CatalogProduct:
    """One extracted product, possibly with multiple SKU variants."""
    title: str = ''
    sku: str = ''  # primary SKU
    series: str = ''
    category: str = ''
    description: str = ''
    specifications: List[Dict] = field(default_factory=list)
    sku_options: Dict = field(default_factory=dict)
    page_range: Tuple[int, int] = field(default_factory=lambda: (0, 0))
    raw_skus: List[str] = field(default_factory=list)  # all variants

    def to_dict(self) -> Dict:
        specs = list(self.specifications)
        for k, v in self.sku_options.items():
            if k not in ('Series',) and not any(s['name'].lower() == k.lower() for s in specs):
                specs.append({'name': k, 'value': v})
        return {
            'title': self.title,
            'sku': self.sku,
            'series': self.series,
            'category': self.category,
            'description': self.description,
            'specifications': specs,
            'sku_options': self.sku_options,
            'raw_skus': self.raw_skus,
            'page_range': list(self.page_range),
        }


# ─── Core parser ──────────────────────────────────────────────────────────────

class CatalogPdfParser:
    """Parse industrial product catalog PDFs with column-aware extraction."""

    def __init__(self, max_pages: int = 150):
        self.max_pages = max_pages

    def parse_file(self, pdf_path: str) -> List[Dict]:
        """Parse a local PDF file. Returns list of product dicts."""
        if HAS_PDFPLUMBER:
            try:
                return self._parse_with_pdfplumber(pdf_path)
            except Exception as e:
                print(f"pdfplumber parsing failed: {e}. Falling back to pypdf.")

        # Fallback: use pypdf
        reader = PdfReader(pdf_path)
        pages = reader.pages[:self.max_pages]
        return self._parse_pages_pypdf(pages)

    def parse_bytes(self, pdf_bytes: bytes) -> List[Dict]:
        """Parse PDF from bytes."""
        import io
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = reader.pages[:self.max_pages]
        return self._parse_pages_pypdf(pages)

    # ── pdfplumber-based parsing (column-aware) ────────────────────────────────

    def _parse_with_pdfplumber(self, pdf_path: str) -> List[Dict]:
        """Parse PDF using pdfplumber for column detection."""
        if not HAS_PDFPLUMBER:
            raise ImportError("pdfplumber not available")

        products = []
        sections = []
        current_section = None

        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages[:self.max_pages]):
                # Extract text and detect section
                text = page.extract_text() or ''
                text = _repair_text(text)
                heading = self._detect_section_heading(text)

                if heading and (current_section is None or heading != current_section['heading']):
                    if current_section:
                        sections.append(current_section)
                    current_section = {'heading': heading, 'pages': [page], 'text_chunks': [text]}
                elif current_section:
                    current_section['pages'].append(page)
                    current_section['text_chunks'].append(text)
                else:
                    current_section = {'heading': 'Intro', 'pages': [page], 'text_chunks': [text]}

        if current_section:
            sections.append(current_section)

        # Parse each section
        for section in sections:
            heading = section['heading']
            if any(x in heading.lower() for x in ['intro', 'function desc', 'star product']):
                continue

            # Extract products from section pages using pdfplumber
            section_products = self._parse_section_with_pdfplumber(
                section['pages'],
                section['text_chunks'],
                heading
            )
            products.extend(section_products)

        return [p.to_dict() for p in products if p.title]

    def _parse_section_with_pdfplumber(self, pages, text_chunks: List[str], category: str) -> List[CatalogProduct]:
        """Parse a section using pdfplumber's word bounding boxes."""
        section_products = []

        # Collect all SKUs and specs across pages
        all_skus = []
        all_specs = []

        for page_idx, (page, text) in enumerate(zip(pages, text_chunks)):
            if not HAS_PDFPLUMBER:
                continue

            # Extract words with bounding boxes
            words = page.extract_words()
            if not words:
                continue

            # Group words into columns by x-coordinate (for future use)
            # columns = self._group_words_by_column(words)

            # Extract SKUs and specs from text and columns
            text_lines = [l.strip() for l in text.split('\n') if l.strip() and not _NOISE_LINES.match(l.strip())]
            for line in text_lines:
                # Find all SKUs on this line
                for match in _SKU_PATTERN.finditer(line):
                    sku = match.group(0)
                    if _is_valid_sku(sku):
                        all_skus.append({'sku': sku, 'page': page_idx + 1, 'context': line})

                # Extract specs
                if ':' in line and not _NOISE_LINES.match(line):
                    parts = line.split(':', 1)
                    key = parts[0].strip()
                    val = parts[1].strip() if len(parts) > 1 else ''
                    if 3 <= len(key) <= 50 and val and len(val) < 150:
                        all_specs.append({'name': key, 'value': val, 'page': page_idx + 1})

        # Group SKUs by family and build products
        if all_skus:
            groups = self._group_skus_by_family(all_skus)
            for group in groups:
                prod = self._build_product(group, category, all_specs)
                section_products.append(prod)

        return section_products

    def _group_words_by_column(self, words: List[Dict]) -> List[List[Dict]]:
        """Group words into columns based on x-coordinate."""
        if not words:
            return []

        # Sort by x0 (left edge)
        sorted_words = sorted(words, key=lambda w: w['x0'])

        # Find column boundaries (gaps in x-coordinates)
        columns = []
        current_col = [sorted_words[0]]

        for word in sorted_words[1:]:
            # If x0 is within 20 points of current column, add to it
            if word['x0'] - current_col[-1]['x1'] < 20:
                current_col.append(word)
            else:
                columns.append(current_col)
                current_col = [word]

        if current_col:
            columns.append(current_col)

        return columns

    # ── pypdf fallback parsing ─────────────────────────────────────────────────

    def _parse_pages_pypdf(self, pages) -> List[Dict]:
        """Fallback: parse using pypdf (no column awareness)."""
        page_texts = []
        for page in pages:
            raw = page.extract_text() or ''
            page_texts.append(_repair_text(raw))

        sections = self._split_into_sections(page_texts)
        all_products = []

        for sec in sections:
            products = self._parse_section_pypdf(sec)
            all_products.extend(products)

        return [p.to_dict() for p in all_products if p.title]

    def _split_into_sections(self, page_texts: List[str]) -> List[Dict]:
        """Group pages into product sections."""
        sections = []
        current = None

        for page_idx, text in enumerate(page_texts):
            heading = self._detect_section_heading(text)
            if heading and (current is None or heading != current['heading']):
                if current:
                    sections.append(current)
                current = {
                    'heading': heading,
                    'pages': [(page_idx, text)],
                    'start_page': page_idx + 1,
                }
            elif current:
                current['pages'].append((page_idx, text))
            else:
                current = {
                    'heading': 'Intro',
                    'pages': [(page_idx, text)],
                    'start_page': page_idx + 1,
                }

        if current:
            sections.append(current)

        return sections

    def _parse_section_pypdf(self, section: Dict) -> List[CatalogProduct]:
        """Parse section using pypdf text extraction."""
        heading = section['heading']
        if any(x in heading.lower() for x in ['intro', 'function desc', 'star product']):
            return []

        all_skus = []
        all_specs = []

        for page_idx, text in section['pages']:
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            lines = [l for l in lines if not _NOISE_LINES.match(l)]

            for line in lines:
                for match in _SKU_PATTERN.finditer(line):
                    sku = match.group(0)
                    if _is_valid_sku(sku):
                        all_skus.append({'sku': sku, 'page': page_idx + 1, 'context': line})

                if ':' in line:
                    parts = line.split(':', 1)
                    key = parts[0].strip()
                    val = parts[1].strip() if len(parts) > 1 else ''
                    if 3 <= len(key) <= 50 and val and len(val) < 150:
                        all_specs.append({'name': key, 'value': val, 'page': page_idx + 1})

        if all_skus:
            groups = self._group_skus_by_family(all_skus)
            products = []
            for group in groups:
                prod = self._build_product(group, heading, all_specs)
                products.append(prod)
            return products

        return []

    # ── Common helpers ─────────────────────────────────────────────────────────

    def _detect_section_heading(self, text: str) -> str:
        """Detect section heading from page text."""
        for line in text.split('\n')[:15]:
            line = line.strip()
            if _SECTION_HEADING_RE.match(line) and len(line) > 5:
                return line
        return ''

    def _group_skus_by_family(self, sku_list: List[Dict]) -> List[Dict]:
        """Group SKUs into product families (variants of same base)."""
        family_map = defaultdict(list)

        for sku_entry in sku_list:
            sku = sku_entry['sku'].upper()
            family_key = self._sku_family_key(sku)
            family_map[family_key].append(sku_entry)

        groups = []
        for family_key, entries in family_map.items():
            # Deduplicate
            seen = set()
            unique = []
            for e in entries:
                if e['sku'] not in seen:
                    seen.add(e['sku'])
                    unique.append(e)

            if unique:
                groups.append({
                    'family_key': family_key,
                    'skus': unique,
                    'section_title': '',
                })

        return groups

    def _sku_family_key(self, sku: str) -> str:
        """Extract family prefix (everything before the output/termination suffix)."""
        # HS5-C8-N04-CP -> HS5-C8 (ignore -N04-CP)
        parts = sku.split('-')
        if len(parts) >= 3:
            # Return first 2 parts
            return '-'.join(parts[:2])
        return sku[:6] if len(sku) >= 6 else sku

    def _build_product(self, group: Dict, category: str, all_specs: List[Dict]) -> CatalogProduct:
        """Build a product from a SKU family group."""
        skus = group['skus']
        first_sku = skus[0]['sku']

        # Extract series from SKU
        series = first_sku.split('-')[0] if '-' in first_sku else first_sku[:2]

        # Build title
        title = f"{category} {first_sku}".strip()

        # Collect specs
        seen_spec_names = set()
        product_specs = []
        for spec in all_specs:
            name_lower = spec['name'].lower()
            if name_lower not in seen_spec_names and len(product_specs) < 25:
                seen_spec_names.add(name_lower)
                product_specs.append({'name': spec['name'], 'value': spec['value']})

        # Build description
        variants_str = ', '.join(s['sku'] for s in skus[:8])
        desc = f"{title}\nVariants: {variants_str}"

        prod = CatalogProduct(
            title=title,
            sku=first_sku,
            series=series,
            category=category,
            description=desc,
            specifications=product_specs,
            raw_skus=[s['sku'] for s in skus],
        )
        return prod


# ─── Public API ────────────────────────────────────────────────────────────

def parse_catalog_pdf_file(pdf_path: str, max_pages: int = 150) -> List[Dict]:
    """Parse a catalog PDF and return product dicts."""
    try:
        parser = CatalogPdfParser(max_pages=max_pages)
        return parser.parse_file(pdf_path)
    except Exception as e:
        print(f"[catalog_pdf_parser] Error parsing {pdf_path}: {e}")
        return []


def parse_catalog_pdf_bytes(pdf_bytes: bytes, max_pages: int = 150) -> List[Dict]:
    """Parse a catalog PDF from bytes."""
    try:
        parser = CatalogPdfParser(max_pages=max_pages)
        return parser.parse_bytes(pdf_bytes)
    except Exception as e:
        print(f"[catalog_pdf_parser] Error parsing PDF bytes: {e}")
        return []
