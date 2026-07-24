import unittest
import requests
import json
import urllib.parse
from auto_template import apply_extraction_rules
from markitdown_service import preprocess_html_content, is_asset_or_image_url, classify_url

class TestEndToEndScraping(unittest.TestCase):
    
    def test_asset_url_filtering(self):
        """Verify that image files, asset links, and wp-content uploads are strictly rejected as products"""
        asset_urls = [
            "https://www.outre.com/wp-content/uploads/PKG_SugarPunch.png",
            "https://www.outre.com/wp-content/uploads/2023/05/banner.jpg?v=123",
            "https://ivyusa.com/cdn/shop/products/item.jpg?width=500",
            "https://example.com/assets/styles.css",
            "https://example.com/static/script.js",
            "https://example.com/document.pdf"
        ]
        for url in asset_urls:
            self.assertTrue(is_asset_or_image_url(url), f"Failed to reject asset URL: {url}")
            cls = classify_url(url, "", "outre.com")
            self.assertEqual(cls, "ignored", f"Classified asset URL as {cls} instead of ignored: {url}")

    def test_outre_product_extraction(self):
        """Test E2E extraction on outre.com product page"""
        url = "https://www.outre.com/product/lulu-wandcurl-8-9-10-6x/"
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
        self.assertEqual(res.status_code, 200, "Failed to fetch outre.com page")
        
        clean_html = preprocess_html_content(res.content)
        product = apply_extraction_rules(clean_html, {})
        
        self.assertTrue(bool(product.get("title")), "Product title is empty")
        self.assertIn("Lulu Wandcurl", product.get("title"), f"Unexpected title: {product.get('title')}")
        self.assertTrue(bool(product.get("description")), "Product description is empty")
        self.assertGreater(len(product.get("images", [])), 0, "No product images extracted")

    def test_ivyusa_product_extraction(self):
        """Test E2E extraction on ivyusa.com product page"""
        url = "https://ivyusa.com/products/rubykisses-24hr-eyes-on-you-liquid-eyeliner"
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if res.status_code == 200:
            clean_html = preprocess_html_content(res.content)
            product = apply_extraction_rules(clean_html, {})
            self.assertTrue(bool(product.get("title")), "Product title is empty on ivyusa.com")

if __name__ == "__main__":
    unittest.main()
