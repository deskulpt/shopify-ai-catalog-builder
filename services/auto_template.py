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

        # 3. Price & Sale Price / Compare-At Price Extraction
        price_val = "0.00"
        compare_at_price_val = ""
        
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

        # Compare at / Original Price
        compare_el = soup.select_one(".compare-at-price, .was-price, .original-price, del, strike, s, .price--compare")
        if compare_el:
            c_match = re.search(r'[\d,\.]+', compare_el.get_text(strip=True))
            if c_match:
                compare_at_price_val = c_match.group(0)
        product["compare_at_price"] = compare_at_price_val

        # 4. Images Extraction (Unwrapping proxy URLs & capturing gallery + variant swatches)
        import urllib.parse
        images = []
        seen_img_urls = set()

        def unwrap_img_url(u_str):
            if not u_str:
                return ""
            if "_next/image?url=" in u_str or "url=" in u_str:
                parsed = urllib.parse.urlparse(u_str)
                qs = urllib.parse.parse_qs(parsed.query)
                if "url" in qs and qs["url"][0]:
                    return qs["url"][0]
            return u_str

        # Scan all images on page for gallery & swatches
        for img in soup.find_all("img"):
            raw_src = img.get("src") or img.get("data-src") or img.get("srcset")
            if raw_src:
                clean_src = unwrap_img_url(raw_src)
                if any(ext in clean_src.lower() for ext in ['.png', '.jpg', '.jpeg', '.webp']) and not any(nobg in clean_src.lower() for nobg in ['logo', 'icon', 'spinner', 'facebook', 'twitter', 'instagram', 'youtube', 'tiktok', 'social']):
                    if clean_src not in seen_img_urls:
                        seen_img_urls.add(clean_src)
                        images.append({"url": clean_src, "alt": img.get("alt", "")})

        if not images:
            og_img = soup.select_one("meta[property='og:image']")
            if og_img and og_img.get("content"):
                c_og = unwrap_img_url(og_img.get("content"))
                images.append({"url": c_og, "alt": product["title"]})

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

        # 6. Metafields / Specifications / Ingredients / Key-Value Extraction
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

        # Extract structured key-value pairs from tables, definition lists, Tailwind grids, and list items
        known_spec_keys = {
            "HAIR MATERIAL", "PREMIUM MIX", "TEXTURE", "STYLE", "COLOR SHOWN", "AVAILABLE COLORS",
            "LENGTH", "LENGTHS", "LACE TYPE", "INGREDIENTS", "MATERIAL", "WEIGHT", "DIMENSIONS",
            "CARE INSTRUCTIONS", "FINISH", "BRAND", "SIZE"
        }

        for row in soup.select("table tr, dl, ul.product-attributes, .specs-list, .product-details li, .ingredients-list, div[class*='grid'], div[class*='flex'], div[class*='spec']"):
            # Check grid/flex sibling pairs
            direct_divs = [c for c in row.find_all("div", recursive=False) if c.get_text(strip=True)]
            if len(direct_divs) >= 2:
                for i in range(len(direct_divs) - 1):
                    lbl = direct_divs[i].get_text(strip=True).rstrip(":").strip()
                    val = direct_divs[i+1].get_text(strip=True).rstrip(",").strip()
                    
                    if lbl.upper() in known_spec_keys:
                        metafields[lbl.upper()] = val
                    elif 3 <= len(lbl) <= 35 and len(val) > 0 and lbl.lower() not in ('price', 'title', 'sku', 'description', 'view more', 'find a store'):
                        if lbl.isupper() and not any(v_sub in lbl for v_sub in ['VIEW MORE', 'STORE', 'FIND']):
                            metafields[lbl] = val

            cells = row.select("td, th, dt, dd, strong, b, span")
            if len(cells) >= 2:
                k = cells[0].get_text(strip=True).rstrip(":").strip()
                v = cells[1].get_text(strip=True).rstrip(",").strip()
                if k and v and 3 <= len(k) <= 40 and k.lower() not in ('price', 'title', 'sku', 'description', 'view more', 'find a store'):
                    metafields[k] = v
            elif row.name == 'li' and (':' in row.get_text() or '-' in row.get_text()):
                txt = row.get_text(strip=True)
                if ':' in txt:
                    parts = txt.split(':', 1)
                    k = parts[0].strip().rstrip(":").strip()
                    v = parts[1].strip().rstrip(",").strip()
                    if k and v and 3 <= len(k) <= 40:
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
    1. EXTRACT ALL SPECIFICATIONS & ATTRIBUTES: Look for pricing, compare-at / original prices, detailed descriptions, ingredients, materials, care instructions, usage directions, dimensions, weight, swatch lists, and metadata key-value pairs (e.g. Hair Material, Texture, Style, Colors Shown, Available Colors, Lengths, Ingredients, Material, Weight, Dimensions, etc.) and put them into "metafields".
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
           {{"title": "Overview", "content": "..."}},
           {{"title": "Ingredients", "content": "..."}}
         ],
         "metafields": {{
           "Ingredients": "Purified Water, Glycerin...",
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
         "compare_at_price": {{"selector": ".compare-at-price", "attr": "text"}},
         "description": {{"selector": ".description", "attr": "text"}},
         "images": {{"selector": ".gallery img", "attr": "src", "multiple": true}},
         "metafields": {{
            "Ingredients": {{"selector": ".ingredients", "attr": "text"}},
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
