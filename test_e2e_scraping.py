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

    def test_playwright_schema_generation_and_metafields(self):
        """Test /generate-schema endpoint with Playwright dynamic DOM rendering for specs & swatches"""
        from markitdown_service import app
        client = app.test_client()
        res = client.post('/generate-schema', json={'url': 'https://www.outre.com/product/onvybe-12/'})
        self.assertEqual(res.status_code, 200, "Failed /generate-schema endpoint call")
        data = res.get_json()
        self.assertTrue(data.get("success"), "Schema generation returned success=False")
        
        prod = data.get("product", {})
        self.assertTrue(bool(prod.get("title")), "Product title is empty")
        self.assertIn("OnVybe 12", prod.get("title"), f"Unexpected title: {prod.get('title')}")
        
        # Verify extracted metafields/specifications
        metafields = prod.get("metafields", {})
        self.assertIn("HAIR MATERIAL", metafields, "HAIR MATERIAL spec missing from metafields")
        self.assertIn("AVAILABLE COLORS", metafields, "AVAILABLE COLORS spec missing from metafields")
        self.assertIn("TEXTURE", metafields, "TEXTURE spec missing from metafields")
        self.assertIn("STYLE", metafields, "STYLE spec missing from metafields")
        
        # Verify gallery and variant swatch images
        images = prod.get("images", [])
        self.assertGreaterEqual(len(images), 5, "Fewer than 5 product gallery/swatch images extracted")
        for img in images[:5]:
            self.assertFalse("_next/image?url=" in img["url"], f"Next.js proxy URL was not unwrapped: {img['url']}")

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
