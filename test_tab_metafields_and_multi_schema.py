import unittest
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "services"))

from markitdown_service import app

class TestTabMetafieldsAndMultiSchema(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()
        self.example_urls = [
            "https://ivyusa.com/products/kiss-new-york-press-go-nails-chrome?variant=43534241235003",
            "https://ivyusa.com/products/melting-jelly-lip-balm?variant=42502048514107"
        ]

    def test_multi_url_schema_generation(self):
        """Test multi-URL example analysis and schema rule merging"""
        res = self.client.post('/generate-schema', json={'urls': self.example_urls})
        self.assertEqual(res.status_code, 200, "Multi-URL generate-schema failed")
        
        data = res.get_json()
        self.assertTrue(data.get("success"), "Multi-URL schema success is False")
        
        prod = data.get("product", {})
        metafields = prod.get("metafields", {})
        
        print("\n--- MERGED METAFIELDS EXTRACTED FROM MULTI-EXAMPLE URLS ---")
        for k, v in metafields.items():
            print(f"Metafield Key: {k} -> {v[:100]}...")
            
        # Verify tab keys are extracted
        self.assertIn("Details", metafields, "Missing 'Details' tab metafield")
        self.assertTrue("How To Use" in metafields or "How to Use" in metafields, "Missing 'How To Use' tab metafield")

    def test_tab_metafields_single_extraction(self):
        """Test tab metafield extraction on single URL extract endpoint"""
        for url in self.example_urls:
            res = self.client.post('/extract', json={'url': url, 'markdown': '# Product Page'})
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data.get("success"))
            prod = data.get("product", {})
            metafields = prod.get("metafields", {})
            self.assertTrue(len(metafields) > 0, f"No metafields extracted for {url}")

if __name__ == "__main__":
    unittest.main()
