import json
import logging
from bs4 import BeautifulSoup
import re

logger = logging.getLogger(__name__)

def apply_extraction_rules(html_content: str, rules: dict) -> dict:
    """
    Applies CSS selector rules to extract product data deterministically.
    rules format:
    {
       "title": {"selector": "h1.title", "attr": "text"},
       "price": {"selector": ".price", "attr": "text"},
       "images": {"selector": ".product-image img", "attr": "src", "multiple": True}
    }
    """
    soup = BeautifulSoup(html_content, "html.parser")
    product = {}
    
    try:
        # Extract basic fields
        for field in ["title", "description"]:
            if field in rules:
                rule = rules[field]
                el = soup.select_one(rule.get("selector", ""))
                if el:
                    val = el.get(rule.get("attr")) if rule.get("attr") and rule.get("attr") != "text" else el.get_text(separator="\n", strip=True)
                    product[field] = val

        # Extract price and clean it
        if "price" in rules:
            rule = rules["price"]
            el = soup.select_one(rule.get("selector", ""))
            if el:
                val = el.get(rule.get("attr")) if rule.get("attr") and rule.get("attr") != "text" else el.get_text(strip=True)
                # Naive price extraction from text
                price_match = re.search(r'[\d,\.]+', val)
                if price_match:
                    product["price"] = price_match.group(0)

        # Extract images
        if "images" in rules:
            rule = rules["images"]
            images = []
            for el in soup.select(rule.get("selector", "")):
                src = el.get(rule.get("attr", "src"))
                if src:
                    images.append({"url": src})
            product["images"] = images

        # Validation: Must have at least a title
        if not product.get("title"):
            raise ValueError("Template broken: Failed to extract title.")
            
        return product
    except Exception as e:
        logger.error(f"Failed to apply extraction rules: {e}")
        return None

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
