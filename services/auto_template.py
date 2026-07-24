import json
import logging
from bs4 import BeautifulSoup
import re

logger = logging.getLogger(__name__)

def apply_extraction_rules(html_content, rules: dict) -> dict:
    """
    Applies CSS selector rules to extract product data deterministically with automatic fallback logic.
    """
    if isinstance(html_content, bytes):
        html_content = html_content.decode('utf-8', errors='ignore')

    soup = BeautifulSoup(html_content, "html.parser")
    product = {
        "title": "",
        "vendor": "",
        "category": "",
        "price": "0.00",
        "sku": "",
        "description": "",
        "metafields": {},
        "options": [],
        "variants": [],
        "images": []
    }
    
    rules = rules or {}
    
    try:
        # 1. Title Extraction with Fallbacks
        title_val = ""
        if "title" in rules and isinstance(rules["title"], dict):
            rule = rules["title"]
            sel = rule.get("selector", "")
            if sel and sel != "title (AI Detected)":
                try:
                    el = soup.select_one(sel)
                    if el:
                        title_val = el.get(rule.get("attr")) if rule.get("attr") and rule.get("attr") != "text" else el.get_text(strip=True)
                except Exception:
                    pass

        if not title_val:
            og_title = soup.select_one("meta[property='og:title']")
            if og_title and og_title.get("content"):
                title_val = og_title.get("content").strip()

        if not title_val:
            t_tag = soup.find("title")
            if t_tag:
                raw_t = t_tag.get_text(strip=True)
                title_val = raw_t.split("-")[0].split("|")[0].strip()

        if not title_val:
            h1 = soup.find(["h1", "h2"])
            if h1:
                title_val = h1.get_text(strip=True)

        product["title"] = title_val or "Extracted Product"

        # 2. Description Extraction with Fallbacks
        desc_val = ""
        if "description" in rules and isinstance(rules["description"], dict):
            rule = rules["description"]
            sel = rule.get("selector", "")
            if sel:
                try:
                    el = soup.select_one(sel)
                    if el:
                        desc_val = el.get(rule.get("attr")) if rule.get("attr") and rule.get("attr") != "text" else el.get_text(separator="\n", strip=True)
                except Exception:
                    pass

        if not desc_val:
            og_desc = soup.select_one("meta[property='og:description']") or soup.select_one("meta[name='description']")
            if og_desc and og_desc.get("content"):
                desc_val = og_desc.get("content").strip()

        if not desc_val:
            desc_el = soup.select_one(".product-description, .description, #tab-description, .entry-content, p")
            if desc_el:
                desc_val = desc_el.get_text(separator="\n", strip=True)

        product["description"] = desc_val

        # 3. Price Extraction with Fallbacks
        price_val = "0.00"
        if "price" in rules and isinstance(rules["price"], dict):
            rule = rules["price"]
            sel = rule.get("selector", "")
            if sel:
                try:
                    el = soup.select_one(sel)
                    if el:
                        raw_p = el.get_text(strip=True)
                        price_match = re.search(r'[\d,\.]+', raw_p)
                        if price_match:
                            price_val = price_match.group(0)
                except Exception:
                    pass

        if price_val == "0.00":
            body_text = soup.get_text()
            price_match = re.search(r'\$\s*([\d,]+\.\d{2})', body_text)
            if price_match:
                price_val = price_match.group(1)

        product["price"] = price_val

        # 4. Images Extraction with Fallbacks
        images = []
        if "images" in rules and isinstance(rules["images"], dict):
            rule = rules["images"]
            sel = rule.get("selector", "")
            if sel:
                try:
                    for el in soup.select(sel):
                        src = el.get(rule.get("attr", "src"))
                        if src:
                            images.append({"url": src, "alt": el.get("alt", "")})
                except Exception:
                    pass

        if not images:
            og_img = soup.select_one("meta[property='og:image']")
            if og_img and og_img.get("content"):
                images.append({"url": og_img.get("content"), "alt": product["title"]})

        if not images:
            for img in soup.select(".gallery img, .product-image img, main img")[:5]:
                src = img.get("src") or img.get("data-src")
                if src and not src.endswith('.svg') and 'logo' not in src.lower():
                    images.append({"url": src, "alt": img.get("alt", "")})

        product["images"] = images

        # 5. Vendor Extraction
        if "vendor" in rules and isinstance(rules["vendor"], dict):
            rule = rules["vendor"]
            sel = rule.get("selector", "")
            if sel:
                try:
                    el = soup.select_one(sel)
                    if el:
                        product["vendor"] = el.get_text(strip=True)
                except Exception:
                    pass

        # 6. Metafields / Specifications Extraction
        metafields = {}
        meta_rules = (rules.get("metafields") or {}) if isinstance(rules.get("metafields"), dict) else {}
        for mk, mrule in meta_rules.items():
            if isinstance(mrule, dict) and mrule.get("selector"):
                try:
                    el = soup.select_one(mrule["selector"])
                    if el:
                        metafields[mk] = el.get_text(strip=True)
                except Exception:
                    pass

        if not metafields:
            for row in soup.select("table tr, dl"):
                cells = row.select("td, th, dt, dd")
                if len(cells) >= 2:
                    k = cells[0].get_text(strip=True).rstrip(":")
                    v = cells[1].get_text(strip=True)
                    if k and v and len(k) < 40:
                        metafields[k] = v

        product["metafields"] = metafields
        return product
    except Exception as e:
        logger.error(f"Failed to apply extraction rules: {e}")
        return product

def build_gemini_template_prompt(html_content: str) -> str:
    return f"""
    You are an expert e-commerce web scraper. Given the following HTML of a product page, 
    thoroughly analyze and extract ALL product data according to the Universal Product Schema below.
    Also generate robust CSS selectors to extract each field and attribute deterministically.

    CRITICAL REQUIREMENTS:
    1. EXPACT ALL SPECIFICATIONS & ATTRIBUTES: Look for specification tables, swatch lists, metadata key-value pairs (e.g. Hair Material, Texture, Style, Colors Shown, Available Colors, Lengths, Material, Weight, Dimensions, etc.) and put them into "metafields".
    2. EXTRACT ALL OPTIONS & VARIANTS: Extract every product option (e.g. Color, Length, Size) into "options" AND every individual variant combination into "variants" (with price, sku, image_url, availability, optionValues).
    3. GENERATE EXTRACTION RULES: Under "extraction_rules", provide CSS selectors for core fields AND for every custom specification key found under metafields!

    Output a JSON object with this exact structure:
    {{
      "product": {{
         "title": "Extracted full product title",
         "vendor": "Brand or manufacturer name",
         "category": "Product category or breadcrumb",
         "tags": ["tag1", "tag2"],
         "price": "10.00",
         "compare_at_price": "15.00",
         "sku": "Base SKU",
         "description": "Main product description",
         "description_sections": [
           {{"title": "Overview", "content": "..."}}
         ],
         "metafields": {{
           "Hair Material": "UNPROCESSED HUMAN HAIR",
           "Texture": "SILKY",
           "Style": "CURLY",
           "Color Shown": "Natural",
           "Available Colors": "NATURAL, Natural Black",
           "Lengths": "10\" 12\" 14\""
         }},
         "options": [
           {{"name": "Color", "values": ["NATURAL", "Natural Black"]}},
           {{"name": "Length", "values": ["10\"", "12\"", "14\""]}}
         ],
         "variants": [
           {{
             "optionValues": [{{"optionName": "Color", "name": "NATURAL"}}, {{"optionName": "Length", "name": "10\""}}],
             "sku": "VAR-NAT-10",
             "price": "29.99",
             "available": true,
             "image_url": "https://..."
           }}
         ],
         "images": [
           {{"url": "https://...", "alt": "Product view"}}
         ]
      }},
      "extraction_rules": {{
         "title": {{"selector": "h1.product-title", "attr": "text"}},
         "price": {{"selector": ".price", "attr": "text"}},
         "description": {{"selector": ".description", "attr": "text"}},
         "images": {{"selector": ".gallery img", "attr": "src", "multiple": true}},
         "metafields": {{
            "Hair Material": {{"selector": ".spec-hair-material", "attr": "text"}},
            "Texture": {{"selector": ".spec-texture", "attr": "text"}},
            "Style": {{"selector": ".spec-style", "attr": "text"}},
            "Lengths": {{"selector": ".spec-lengths", "attr": "text"}}
         }}
      }}
    }}
    
    Ensure CSS selectors are specific and reliable.
    Look deeply into structured data tags, HTML text nodes, tables, and dropdowns for all variants and specifications.
    
    HTML Content:
    {html_content[:120000]} 
    """
