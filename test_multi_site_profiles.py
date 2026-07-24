import unittest
import requests
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "services"))

from markitdown_service import app, preprocess_html_content, is_asset_or_image_url, classify_url, fetch_html_rendered_bytes
from auto_template import apply_extraction_rules

class TestMultiSiteProfilesMatrix(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()
        self.profiles = [
            {
                "site": "Outre Hair (Next.js / Headless WooCommerce)",
                "domain": "outre.com",
                "urls": [
                    "https://www.outre.com/product/onvybe-12/",
                    "https://www.outre.com/product/sugar-punch-bohemian-multi/"
                ],
                "min_images": 5,
                "expected_metafields": ["HAIR MATERIAL", "TEXTURE", "STYLE", "AVAILABLE COLORS"]
            },
            {
                "site": "Ivy Beauty Cosmetics (Shopify)",
                "domain": "ivyusa.com",
                "urls": [
                    "https://ivyusa.com/products/rubykisses-24hr-eyes-on-you-liquid-eyeliner"
                ],
                "min_images": 1,
                "expected_metafields": []
            }
        ]

    def test_multi_site_schema_generation(self):
        """Loop through all target websites & profiles to verify schema accuracy, title, pricing, images, and metafields"""
        for prof in self.profiles:
            site_name = prof["site"]
            for url in prof["urls"]:
                with self.subTest(site=site_name, url=url):
                    res = self.client.post('/generate-schema', json={'url': url})
                    self.assertEqual(res.status_code, 200, f"Schema generation failed for {site_name} at {url}")
                    
                    data = res.get_json()
                    self.assertTrue(data.get("success"), f"Success is False for {site_name} at {url}")
                    
                    prod = data.get("product", {})
                    self.assertTrue(bool(prod.get("title")), f"Product title is empty for {site_name} at {url}")
                    self.assertGreaterEqual(len(prod.get("images", [])), prof["min_images"], f"Insufficient images for {site_name} at {url}")
                    
                    metafields = prod.get("metafields", {})
                    for expected_mf in prof["expected_metafields"]:
                        found = expected_mf in metafields or expected_mf.rstrip("S") in metafields
                        self.assertTrue(found, f"Missing metafield {expected_mf} on {site_name}. Found: {list(metafields.keys())}")

    def test_multi_site_asset_exclusion(self):
        """Verify that static assets and CDN images across sites are strictly excluded from queue ingest"""
        asset_urls = [
            "https://www.outre.com/wp-content/uploads/PKG_SugarPunch.png",
            "https://ivyusa.com/cdn/shop/products/item.jpg?width=500",
            "https://cdn.shopify.com/s/files/1/0000/0000/files/banner.png",
            "https://example.com/assets/app.js",
            "https://example.com/styles.css"
        ]
        for url in asset_urls:
            self.assertTrue(is_asset_or_image_url(url), f"Asset URL was not filtered: {url}")
            domain = url.split("/")[2]
            cls = classify_url(url, "", domain)
            self.assertEqual(cls, "ignored", f"Asset URL {url} classified as {cls}")

    def test_multi_site_publish_payload_creation(self):
        """Verify Shopify publishing payload creation for multi-site extracted products"""
        for prof in self.profiles:
            site_name = prof["site"]
            sample_url = prof["urls"][0]
            
            # Fetch rendered bytes & extract product
            raw_bytes = fetch_html_rendered_bytes(sample_url)
            clean_html = preprocess_html_content(raw_bytes)
            prod = apply_extraction_rules(clean_html, {})
            
            # Convert extracted product into Shopify publish payload
            specs = [{"name": k, "value": v} for k, v in prod.get("metafields", {}).items()]
            
            payload = {
                "title": prod.get("title", "Untitled Product"),
                "descriptionHtml": prod.get("description", ""),
                "vendor": prod.get("vendor", prof["domain"]),
                "price": prod.get("price", "0.00"),
                "sku": prod.get("sku", ""),
                "specifications": specs,
                "options": prod.get("options", []),
                "variants": prod.get("variants", []),
                "media_links": prod.get("images", [])
            }
            
            self.assertTrue(bool(payload["title"]), f"Publish payload title missing for {site_name}")
            self.assertIsInstance(payload["specifications"], list, f"Specifications payload not a list for {site_name}")

if __name__ == "__main__":
    unittest.main()
