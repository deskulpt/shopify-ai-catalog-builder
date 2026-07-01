"""
moa_extraction.py
━━━━━━━━━━━━━━━━━━━━━
MOA (Mixture of Agents) extraction enhancement module.
Uses Perplexity Pro (unlimited access) to enrich and validate
product extraction results from markdown.

When AI API keys (OpenAI/Gemini) set: enhances AI extraction
When no API keys: provides full AI-powered extraction via Perplexity

Flow:
  1. Extract base product data (rule-based or AI)
  2. Send product markdown to Perplexity for enrichment
  3. Validate and merge results
  4. Return enhanced structured data
"""

import json
import os
import re
import requests as http_req
from typing import Optional, Dict, Any, List

# ─── Configuration ───────────────────────────────────────────────────────────

PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
PERPLEXITY_MODEL = "sonar-deep-research"  # reasoning-capable model

# Perplexity API key from env or fallback
PERPLEXITY_API_KEY = (
    os.environ.get("PERPLEXITY_API_KEY") or
    os.environ.get("PPLX_API_KEY")
)

# Whether Perplexity is available
HAS_PERPLEXITY = bool(PERPLEXITY_API_KEY)

# Fallback to local daemon if API key not set
PERPLEXITY_DAEMON_URL = os.environ.get("PERPLEXITY_DAEMON_URL") or "http://127.0.0.1:53314"


def _call_perplexity_api(prompt: str) -> Optional[str]:
    """Call Perplexity API with structured output request."""
    if not HAS_PERPLEXITY:
        return None

    headers = {
        "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": PERPLEXITY_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a product data extraction specialist. "
                    "Extract structured product information from markdown. "
                    "Respond ONLY with valid JSON. No markdown, no explanations."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 4096,
    }

    try:
        resp = http_req.post(
            PERPLEXITY_API_URL,
            headers=headers,
            json=payload,
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return content
        else:
            print(f"Perplexity API error: {resp.status_code}")
            return None
    except Exception as e:
        print(f"Perplexity API call failed: {e}")
        return None


def _call_perplexity_daemon(prompt: str) -> Optional[str]:
    """Call local Perplexity MCP daemon for extraction."""
    try:
        resp = http_req.post(
            f"{PERPLEXITY_DAEMON_URL}/v1/chat/completions",
            json={
                "model": "sonar",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Extract structured product data from markdown. "
                            "Return ONLY JSON."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.0,
            },
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        pass
    return None


def enhance_extraction(
    markdown: str,
    base_result: dict,
    domain: str = "",
    url: str = "",
) -> dict:
    """
    Enhance a rule-based extraction result using Perplexity AI.
    Merges Perplexity's structured output with the base result,
    preferring Perplexity fields when they are non-null.

    Returns the enhanced result dict (mutated copy).
    """
    result = dict(base_result)  # shallow copy

    # Build extraction prompt
    prompt = f"""Extract product information from this markdown content.

CRITICAL RULES:
- title: The product name (first heading or most prominent name)
- sku: Product SKU/code if present
- price: Numeric price value (number only, no currency symbol)
- currency: ISO 4217 currency code (USD, EUR, INR, GBP, etc.)
- price_unit: Unit like "each", "meter", "piece", "roll" or empty
- purchase_type: "direct_buy" if fixed price, "quote_only" if "request a quote" / "call for price"
- vendor: Brand/manufacturer name
- short_description: Brief 2-3 sentence description
- specifications: Array of {{"name": "...", "value": "..."}} objects
- media_links: Array of {{"url": "...", "alt": "..."}} for product images
- file_links: Array of {{"url": "...", "text": "..."}} for PDFs/documents
- options: Array of {{"name": "...", "values": [...]}} for variant options
- variants: Array of {{"sku": "...", "price": "...", "optionValues": [...]}}

Page URL: {url}
Domain: {domain}

MARKDOWN CONTENT:
{markdown[:8000]}

Respond with a JSON object ONLY. No markdown formatting, no code blocks.
"""

    # Try API first, then daemon
    raw_response = _call_perplexity_api(prompt)
    if not raw_response:
        raw_response = _call_perplexity_daemon(prompt)

    if not raw_response:
        # No Perplexity available, return base result as-is
        return result

    # Parse the JSON response
    try:
        # Strip any markdown code fences if present
        cleaned = raw_response.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        ai_data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        print(f"Failed to parse Perplexity response: {e}")
        print(f"Raw: {raw_response[:500]}")
        return result

    # Merge AI data into result (AI fields override base when non-null)
    scalar_fields = [
        "title", "sku", "price", "currency", "price_unit",
        "purchase_type", "vendor", "short_description",
    ]
    for field in scalar_fields:
        ai_val = ai_data.get(field)
        if ai_val is not None and str(ai_val).strip():
            result[field] = ai_val

    # Merge specifications
    ai_specs = ai_data.get("specifications", [])
    if ai_specs and isinstance(ai_specs, list):
        # Merge: AI specs override base specs by name
        base_specs = {
            s.get("name", "").lower(): s
            for s in result.get("specifications", [])
        }
        for spec in ai_specs:
            name = spec.get("name", "")
            if name and name.lower() in base_specs:
                base_specs[name.lower()]["rawValue"] = spec.get("value", spec.get("rawValue", ""))
            elif name:
                base_specs[name.lower()] = {"name": name, "rawValue": spec.get("value", "")}
        result["specifications"] = list(base_specs.values())

    # Merge media links
    ai_media = ai_data.get("media_links", [])
    if ai_media and isinstance(ai_media, list):
        existing_urls = {m.get("url") for m in result.get("media_links", [])}
        for m in ai_media:
            if m.get("url") and m["url"] not in existing_urls:
                result.setdefault("media_links", []).append(m)
                existing_urls.add(m["url"])

    # Merge file links
    ai_files = ai_data.get("file_links", [])
    if ai_files and isinstance(ai_files, list):
        existing_urls = {f.get("url") for f in result.get("file_links", [])}
        for f in ai_files:
            if f.get("url") and f["url"] not in existing_urls:
                result.setdefault("file_links", []).append(f)

    return result


def batch_extract_moa(
    products_markdown: List[Dict[str, str]],
    domain: str = "",
) -> List[dict]:
    """
    MOA-style batch extraction: process multiple product markdowns
    in sequence (Perplexity API rate limits) and return enhanced results.

    Each item in products_markdown: {"id": "...", "markdown": "...", "url": "..."}
    """
    results = []

    for item in products_markdown:
        md = item.get("markdown", "")
        url = item.get("url", "")
        base_result = {
            "title": "",
            "price": "0.00",
            "currency": "USD",
            "purchase_type": "direct_buy",
            "specifications": [],
            "media_links": [],
            "file_links": [],
            "options": [],
            "variants": [],
        }

        enhanced = enhance_extraction(md, base_result, domain, url)
        enhanced["_source_id"] = item.get("id", "")
        results.append(enhanced)

    return results
