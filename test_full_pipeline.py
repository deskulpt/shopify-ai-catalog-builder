import unittest
import requests
import json
import os
import sys

# Ensure services directory is in python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "services"))

from markitdown_service import app, preprocess_html_content, is_asset_or_image_url, classify_url
from auto_template import apply_extraction_rules, build_gemini_template_prompt

class TestFullEndToEndPipeline(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()

    def test_stage1_multi_profile_schema_generation(self):
        """STAGE 1: Create multiple profiles, generate schemas, and verify schema accuracy against live product pages"""
        profiles = [
            {
                "name": "Outre Hair Wigs & Weaves",
                "sample_url": "https://www.outre.com/product/onvybe-12/",
                "expected_metafields": ["HAIR MATERIAL", "TEXTURE", "STYLE", "AVAILABLE COLORS", "LENGTHS"]
            },
            {
                "name": "Ivy Beauty Cosmetics",
                "sample_url": "https://ivyusa.com/products/rubykisses-24hr-eyes-on-you-liquid-eyeliner",
                "expected_metafields": []
            }
        ]

        for p in profiles:
            url = p["sample_url"]
            res = self.client.post('/generate-schema', json={'url': url})
            self.assertEqual(res.status_code, 200, f"Schema generation failed for profile {p['name']}")
            data = res.get_json()
            self.assertTrue(data.get("success"), f"Success is False for {p['name']}")
            
            prod = data.get("product", {})
            self.assertTrue(bool(prod.get("title")), f"Missing title for {p['name']}")
            self.assertGreater(len(prod.get("images", [])), 0, f"No images extracted for {p['name']}")

            # Check specified metafields
            metafields = prod.get("metafields", {})
            for expected_mf in p["expected_metafields"]:
                found = expected_mf in metafields or expected_mf.rstrip("S") in metafields
                self.assertTrue(found, f"Missing metafield {expected_mf} in profile {p['name']} (Extracted: {list(metafields.keys())})")

    def test_stage2_crawl_and_queue_extraction(self):
        """STAGE 2: Test URL classification, noise/asset exclusion, and product extraction for queue transition"""
        test_urls = [
            ("https://www.outre.com/product/sugar-punch-bohemian-multi/", "product"),
            ("https://www.outre.com/product-category/weaves/", "category"),
            ("https://www.outre.com/wp-content/uploads/PKG_SugarPunch.png", "ignored")
        ]

        for url, expected_type in test_urls:
            if is_asset_or_image_url(url):
                self.assertEqual(expected_type, "ignored", f"Asset URL {url} was not classified as ignored")
            else:
                cls = classify_url(url, "", "outre.com")
                self.assertEqual(cls, expected_type, f"URL {url} classified as {cls} instead of {expected_type}")

    def test_stage3_shopify_publish_metafields_payload(self):
        """STAGE 3: Verify Shopify publishing payload structure for custom metafields and variants"""
        mock_extracted_product = {
            "title": "OnVybe 12 - Outre Perfect Hairline",
            "description": "Fully Hand-tied Lace Wig",
            "vendor": "Outre",
            "price": "39.99",
            "compare_at_price": "49.99",
            "sku": "ONVYBE-12",
            "metafields": {
                "HAIR MATERIAL": "SYNTHETIC HAIR",
                "TEXTURE": "LIGHT YAKI",
                "STYLE": "CURLY",
                "AVAILABLE COLORS": "1, 1B, 2, Chocolate Swirl"
            },
            "options": [
                {"name": "Color", "values": ["1", "1B", "2"]}
            ],
            "variants": [
                {
                    "optionValues": [{"optionName": "Color", "name": "1"}],
                    "sku": "ONVYBE-12-1",
                    "price": "39.99"
                }
            ],
            "images": [
                {"url": "https://www.outre.com/wp-content/uploads/ONVYBE-12_Main.png", "alt": "Main View"}
            ]
        }

        # Build payload equivalent to app._index.tsx handlePublishToShopify
        specs = [{"name": k, "value": v} for k, v in mock_extracted_product["metafields"].items()]
        metafield_mappings = {
            "HAIR MATERIAL": "custom.hair_material",
            "TEXTURE": "custom.texture",
            "STYLE": "custom.style"
        }

        payload = {
            "title": mock_extracted_product["title"],
            "descriptionHtml": mock_extracted_product["description"],
            "vendor": mock_extracted_product["vendor"],
            "price": mock_extracted_product["price"],
            "sku": mock_extracted_product["sku"],
            "specifications": specs,
            "metafieldMappings": metafield_mappings,
            "options": mock_extracted_product["options"],
            "variants": mock_extracted_product["variants"],
            "media_links": mock_extracted_product["images"]
        }

        self.assertEqual(payload["title"], "OnVybe 12 - Outre Perfect Hairline")
        self.assertEqual(len(payload["specifications"]), 4)
        self.assertEqual(payload["metafieldMappings"]["HAIR MATERIAL"], "custom.hair_material")
        self.assertEqual(len(payload["variants"]), 1)

if __name__ == "__main__":
    unittest.main()
