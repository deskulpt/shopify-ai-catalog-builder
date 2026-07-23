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
    You are an expert web scraper. Given the following HTML of a product page, 
    generate CSS selectors to extract the core product data.
    
    Output a JSON object with this exact structure:
    {{
      "product": {{
         "title": "Extracted Title",
         "price": "10.00",
         "description": "Extracted desc...",
         "images": [{{"url": "img1.jpg"}}]
      }},
      "extraction_rules": {{
         "title": {{"selector": "h1.product-title", "attr": "text"}},
         "price": {{"selector": ".price-item", "attr": "text"}},
         "images": {{"selector": ".gallery img", "attr": "src", "multiple": true}}
      }}
    }}
    
    Ensure the CSS selectors are specific enough to work reliably.
    HTML Content:
    {html_content[:100000]} 
    """
