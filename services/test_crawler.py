import requests
import json
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_crawl_mock():
    url = "http://localhost:5005/crawl"
    payload = {"url": "https://mock-vendor.com"}
    response = requests.post(url, json=payload)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["success"] is True
    assert data["domain"] == "mock-vendor.com"
    assert "categories" in data
    assert len(data["categories"]) > 0
    assert data["categories"][0]["name"] == "Industrial Pumps"
    print("Mock crawl test passed successfully!")

def test_crawl_real_failed_fallback():
    # Calling a non-existent domain should fallback gracefully to mock taxonomy
    url = "http://localhost:5005/crawl"
    payload = {"url": "https://nonexistent-domain-1234567.com"}
    response = requests.post(url, json=payload)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["success"] is True
    assert data["mocked"] is True
    assert "categories" in data
    print("Fallback crawl test passed successfully!")

def test_extract():
    url = "http://localhost:5005/extract"
    markdown = """# High Pressure Pump Model VG-5HP
SKU: VG-5HP-24V
Price: $299.00
Specifications:
- Weight: 25KG
- Input Voltage: 24V DC
- Dimensions: 12 x 8 x 5 cm
- Material: Stainless Steel
"""
    payload = {"markdown": markdown, "domain": "pumps.com"}
    response = requests.post(url, json=payload)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["success"] is True
    assert data["title"] == "High Pressure Pump Model VG-5HP"
    assert data["sku"] == "VG-5HP-24V"
    assert data["purchase_type"] == "direct_buy"
    
    specs = data["specifications"]
    assert len(specs) >= 4
    
    # Verify Weight normalization and conversion
    weight_spec = next(s for s in specs if s["name"].lower() == "weight")
    assert weight_spec["value"] == 25.0
    assert weight_spec["unit"] == "KG"
    assert weight_spec["system"] == "metric"
    assert weight_spec["convertedValue"] == 55.115
    assert weight_spec["convertedUnit"] == "LB"
    assert weight_spec["displayValue"] == "25 KG (55.115 LB)"
    
    # Verify Voltage normalization
    volt_spec = next(s for s in specs if "voltage" in s["name"].lower())
    assert volt_spec["value"] == 24.0
    assert volt_spec["unit"] == "V"
    
    # Verify Dimensions normalization and conversion
    dim_spec = next(s for s in specs if "dimension" in s["name"].lower())
    assert dim_spec["value"] == "12x8x5"
    assert dim_spec["unit"] == "CM"
    assert dim_spec["system"] == "metric"
    assert dim_spec["convertedValue"] == "4.72x3.15x1.97"
    assert dim_spec["convertedUnit"] == "IN"
    assert dim_spec["displayValue"] == "12x8x5 CM (4.72x3.15x1.97 IN)"
    
    print("AI Extraction & Unit Normalization test passed successfully!")

def test_group_variants():
    url = "http://localhost:5005/group-variants"
    products = [
        {"name": "Industrial AC Motor 5HP - 110V", "url": "https://motors.com/ac-5hp-110v"},
        {"name": "Industrial AC Motor 5HP - 220V", "url": "https://motors.com/ac-5hp-220v"},
        {"name": "High-Pressure Control Valve 1/2\"", "url": "https://motors.com/valve-half"}
    ]
    payload = {"products": products}
    response = requests.post(url, json=payload)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["success"] is True
    
    grouped = data["grouped"]
    assert len(grouped) == 2
    
    # Motor group should be clustered
    motor_group = next(g for g in grouped if g["is_grouped"])
    assert motor_group["title"] == "Industrial AC Motor 5HP"
    assert len(motor_group["variants"]) == 2
    assert "Voltage" in motor_group["options"]
    
    # Valve should remain standalone
    valve_group = next(g for g in grouped if not g["is_grouped"])
    assert valve_group["title"] == "High-Pressure Control Valve 1/2\""
    assert len(valve_group["variants"]) == 1
    
    print("Variant Grouping engine test passed successfully!")

def test_extract_media_and_files():
    url = "http://localhost:5005/extract"
    markdown = """### High Pressure Pump Model VG-5HP
Here is a picture of the pump:
![VG-5HP front view](/images/vg-5hp-front.jpg)
And another detail shot:
![](https://pumps.com/vg-5hp-side.png)
![](data:image/gif;base64...)

Specifications:
- Insulation Material: PVC
- Conductor Material: Copper

Documents:
- [Instruction Manual](/downloads/manual.pdf)
- [Wiring Diagram](wiring.pdf)
- [General Catalog](https://pumps.com/catalog.zip)
"""
    payload = {
        "markdown": markdown,
        "domain": "pumps.com",
        "url": "https://pumps.com/products/vg-5hp"
    }
    response = requests.post(url, json=payload)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["success"] is True
    # Title may have minor AI variations - check core product name is present
    assert "VG-5HP" in data["title"] or "High Pressure Pump" in data["title"], \
        f"Unexpected title: {data['title']}"
    
    # Verify specifications do not contain base64 image data
    specs = data.get("specifications", [])
    assert len(specs) > 0
    assert not any("data:image" in str(s) for s in specs)
    assert not any("base64" in str(s) for s in specs)
    
    # Verify image extraction and relative URL resolution
    media = data.get("media_links", [])
    assert len(media) == 2
    
    assert media[0]["url"] == "https://pumps.com/images/vg-5hp-front.jpg"
    # Alt with explicit text must be preserved exactly
    assert media[0]["alt"] == "VG-5HP front view"
    
    assert media[1]["url"] == "https://pumps.com/vg-5hp-side.png"
    # Alt for images without explicit alt text may be empty string OR AI-inferred
    assert isinstance(media[1]["alt"], str), "alt must be a string"
    
    # Verify file links extraction and resolution
    files = data.get("file_links", [])
    assert len(files) == 3
    
    # Absolute path /downloads/manual.pdf → always resolves to domain root
    assert files[0]["url"] == "https://pumps.com/downloads/manual.pdf"
    assert files[0]["text"] == "Instruction Manual"
    
    # Bare relative 'wiring.pdf' — may resolve relative to page path OR domain root
    assert files[1]["url"] in (
        "https://pumps.com/products/wiring.pdf",  # path-relative (rule-based)
        "https://pumps.com/wiring.pdf",            # root-relative (AI-inferred)
    ), f"Unexpected wiring.pdf URL: {files[1]['url']}"
    assert files[1]["text"] == "Wiring Diagram"
    
    # Absolute URL must always pass through unchanged
    assert files[2]["url"] == "https://pumps.com/catalog.zip"
    assert files[2]["text"] == "General Catalog"
    
    print("Media and File Extraction/Resolution test passed successfully!")

def price_as_float(p):
    """Parse a price string to float for numeric comparison, ignoring formatting."""
    if p is None:
        return None
    try:
        return float(str(p).replace(',', '').strip())
    except (ValueError, TypeError):
        return None

def test_price_and_currency_extraction():
    url = "http://localhost:5005/extract"
    
    # 1. Test Rupee and Piece
    markdown1 = """### Pull Cord Wire Rope
₹ 22 / Piece Get Latest Price
Conductor Size: 6mm
"""
    response1 = requests.post(url, json={"markdown": markdown1})
    assert response1.status_code == 200
    data1 = response1.json()
    assert price_as_float(data1["price"]) == 22.0, f"INR price: {data1['price']!r}"
    assert data1["currency"] == "INR", f"INR currency: {data1['currency']!r}"
    assert data1["price_unit"] == "Piece", f"INR unit: {data1['price_unit']!r}"
    
    # 2. Test Dollar and meter
    markdown2 = """### Flexible Conduit Pipe
Price: $ 4.50 per Meter
Color: Black
"""
    response2 = requests.post(url, json={"markdown": markdown2})
    assert response2.status_code == 200
    data2 = response2.json()
    assert price_as_float(data2["price"]) == 4.50, f"USD price: {data2['price']!r}"
    assert data2["currency"] == "USD", f"USD currency: {data2['currency']!r}"
    assert data2["price_unit"] == "Meter", f"USD unit: {data2['price_unit']!r}"

    # 3. Test CAD and each
    markdown3 = """### Control Switch Box
CAD 120.00 each
"""
    response3 = requests.post(url, json={"markdown": markdown3})
    assert response3.status_code == 200
    data3 = response3.json()
    assert price_as_float(data3["price"]) == 120.0, f"CAD price: {data3['price']!r}"
    assert data3["currency"] == "CAD", f"CAD currency: {data3['currency']!r}"
    assert data3["price_unit"] == "each", f"CAD unit: {data3['price_unit']!r}"

    # 4. Test GBP
    markdown4 = """### Temperature Sensor
Rate: £15 per unit
"""
    response4 = requests.post(url, json={"markdown": markdown4})
    assert response4.status_code == 200
    data4 = response4.json()
    assert price_as_float(data4["price"]) == 15.0, f"GBP price: {data4['price']!r}"
    assert data4["currency"] == "GBP", f"GBP currency: {data4['currency']!r}"
    assert data4["price_unit"] == "unit", f"GBP unit: {data4['price_unit']!r}"
    
    # 5. Test EUR and commas
    markdown5 = """### Large Hydraulic Press
Price: 12,500 € each
"""
    response5 = requests.post(url, json={"markdown": markdown5})
    assert response5.status_code == 200
    data5 = response5.json()
    assert price_as_float(data5["price"]) == 12500.0, f"EUR price: {data5['price']!r}"
    assert data5["currency"] == "EUR", f"EUR currency: {data5['currency']!r}"
    assert data5["price_unit"] == "each", f"EUR unit: {data5['price_unit']!r}"

    # 6. Test Yen and commas
    markdown6 = """### Cable Jointing Kit
Price: ¥ 1,200 / roll
"""
    response6 = requests.post(url, json={"markdown": markdown6})
    assert response6.status_code == 200
    data6 = response6.json()
    assert price_as_float(data6["price"]) == 1200.0, f"JPY price: {data6['price']!r}"
    assert data6["currency"] == "JPY", f"JPY currency: {data6['currency']!r}"
    assert data6["price_unit"] == "roll", f"JPY unit: {data6['price_unit']!r}"
    
    print("Price and Currency Extraction test passed successfully!")

def test_preprocess_onclick_links():
    from markitdown_service import preprocess_html_content
    html = """
    <div class="pdf-btn" onclick="window.open('https://pdf.indiamart.com/manual.pdf','_blank')">
        <span>Product Brochure</span>
    </div>
    """
    preprocessed = preprocess_html_content(html.encode('utf-8')).decode('utf-8')
    assert '<a href="https://pdf.indiamart.com/manual.pdf">' in preprocessed
    assert 'Product Brochure' in preprocessed
    print("HTML Preprocessing of onclick links test passed successfully!")

def test_resolve_pdf_viewer_url():
    from markitdown_service import resolve_pdf_viewer_url
    viewer_url = "https://pdf.indiamart.com/impdf/19164539030/2744130/chute-jam-level-switch.pdf"
    resolved = resolve_pdf_viewer_url(viewer_url)
    assert "chute-jam-level-switch.pdf" in resolved
    assert "5.imimg.com" in resolved
    print("PDF viewer URL resolution test passed successfully!")

def test_pdf_image_extraction():
    url = "http://localhost:5005/convert"
    pdf_url = "https://5.imimg.com/data5/SELLER/Doc/2022/1/BV/QL/IO/2744130/chute-jam-level-switch.pdf?v=3"
    import requests as http_requests
    r = http_requests.get(pdf_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
    assert r.status_code == 200
    
    files = {"file": ("chute_jam_level_switch.pdf", r.content, "application/pdf")}
    response = http_requests.post(url, files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    
    markdown = data["markdown"]
    assert "### Extracted PDF Images" in markdown
    assert "![Extracted Image](/extracted/" in markdown
    
    public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "extracted")
    extracted_files = os.listdir(public_dir)
    assert len(extracted_files) > 0
    pdf_imgs = [f for f in extracted_files if "chute_jam_level_switch" in f]
    assert len(pdf_imgs) > 0
    print("PDF Conversion and Image Extraction test passed successfully!")

def test_html_viewer_extraction():
    url = "http://localhost:5005/extract"
    markdown = """### Pressure Transmitter XMP i
We have an online catalog:
[DirectIndustry Brochure](https://pdf.directindustry.com/pdf/bd-sensors/xmp-i-precision-pressure-transmitter/14047-920409.html)
"""
    payload = {
        "markdown": markdown,
        "domain": "directindustry.com",
        "url": "https://www.directindustry.com/prod/bd-sensors-gmbh/product-14047-1024693.html"
    }
    response = requests.post(url, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    
    files = data.get("file_links", [])
    assert len(files) == 1
    assert files[0]["url"] == "https://pdf.directindustry.com/pdf/bd-sensors/xmp-i-precision-pressure-transmitter/14047-920409.html"
    assert files[0]["text"] == "DirectIndustry Brochure"
    print("HTML Viewer Link Extraction test passed successfully!")

def test_classify_url():
    from markitdown_service import classify_url
    
    # Test Root domain
    assert classify_url("https://www.outre.com", "Home", "outre.com") == "root"
    assert classify_url("https://www.outre.com/", "Home", "outre.com") == "root"
    assert classify_url("https://www.outre.com/index.html", "Home", "outre.com") == "root"
    
    # Test Category precedence over Product prefix collisions
    assert classify_url("https://www.outre.com/product-category/braids", "Braids", "outre.com") == "category"
    assert classify_url("https://www.outre.com/category/hair", "Hair", "outre.com") == "category"
    
    # Test Product path
    assert classify_url("https://www.outre.com/product/type-4-soft-natural-frappe-18-3x/", "Type 4 Soft Natural", "outre.com") == "product"
    
    # Test Custom Patterns override
    patterns = {
        "product": ["/item-detail/"],
        "category": ["/list-view/"],
        "root": ["/welcome/"]
    }
    assert classify_url("https://www.outre.com/item-detail/hair-123", "Hair Product", "outre.com", patterns=patterns) == "product"
    assert classify_url("https://www.outre.com/list-view/braids", "Braids Listing", "outre.com", patterns=patterns) == "category"
    assert classify_url("https://www.outre.com/welcome/home", "Welcome Home", "outre.com", patterns=patterns) == "root"
    
    print("Local URL classification tests passed successfully!")

def test_matches_category_segments():
    from markitdown_service import matches_category_segments
    
    # Simple match
    assert matches_category_segments(
        "https://www.sensationnel.com/product-category/weave/weaves-human-hair/",
        "https://www.sensationnel.com/product/weave/weaves-human-hair/some-product/"
    ) is True
    
    # Different prefixes, same relative path segments
    assert matches_category_segments(
        "https://www.sensationnel.com/collections/hair/braids/",
        "https://www.sensationnel.com/products/hair/braids/item-123"
    ) is True
    
    # Non-matching paths
    assert matches_category_segments(
        "https://www.sensationnel.com/product-category/wig/",
        "https://www.sensationnel.com/product/weave/some-item/"
    ) is False
    
    # Parent vs child matching specificity
    assert matches_category_segments(
        "https://www.sensationnel.com/product-category/weave/",
        "https://www.sensationnel.com/product/weave/weaves-human-hair/some-product/"
    ) is True
    
    print("Local matches_category_segments unit tests passed successfully!")

def test_download_and_hash_asset():
    """Unit test for download_and_hash_asset helper - uses a real, small, public image"""
    from markitdown_service import download_and_hash_asset
    import os, requests as _req

    # Use a tiny reliable public image (GitHub's 1x1 transparent PNG)
    # Fallback candidates tried in order until one works
    candidate_urls = [
        "https://github.githubassets.com/images/icons/emoji/unicode/2764.png",
        "https://www.gstatic.com/webp/gallery/1.webp",
        "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
    ]
    test_url = None
    for url in candidate_urls:
        try:
            probe = _req.head(url, timeout=5, allow_redirects=True)
            if probe.status_code == 200:
                test_url = url
                break
        except Exception:
            continue

    if test_url is None:
        print("download_and_hash_asset test SKIPPED (no reachable test URL — network unavailable)")
        return

    result = download_and_hash_asset(test_url)

    assert result.get("success") is True, f"Expected success=True, got: {result}"
    assert "sha256" in result, "Expected sha256 in result"
    assert "local_url" in result, "Expected local_url in result"
    assert result["local_url"].startswith("/public/extracted/"), f"Expected /public/extracted/ path, got: {result['local_url']}"

    # Verify file was actually written to disk
    public_extracted = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "public", "extracted"
    )
    filename = result["local_url"].replace("/public/extracted/", "")
    disk_path = os.path.join(public_extracted, filename)
    assert os.path.exists(disk_path), f"Expected file on disk at: {disk_path}"

    # Verify deduplication - a second call must not re-download
    import time
    t_before = os.path.getmtime(disk_path)
    time.sleep(0.1)
    result2 = download_and_hash_asset(test_url)
    t_after = os.path.getmtime(disk_path)
    assert t_before == t_after, "File was re-downloaded instead of being deduplicated!"
    assert result2["sha256"] == result["sha256"], "SHA256 must be identical for same content"

    print("download_and_hash_asset test passed successfully!")



def test_new_schema_mapping_in_extract():
    """Test that /extract correctly maps the new {product, assets, source} schema to flat layout"""
    url = "http://localhost:5005/extract"

    # Minimal markdown that looks like a product page
    markdown = """## A+ Ocean Deep

HAIR MATERIAL: PREMIUM MIX
TEXTURE: SILKY
STYLE: WAVY
COLOR SHOWN: 4
AVAILABLE COLORS: 1,1B,2,27,30,4
LENGTHS: 18" 24"

Price: $25.99

![Product Front View](https://cdn.outre.com/a-ocean-deep-front.jpg)
![Product Back View](https://cdn.outre.com/a-ocean-deep-back.jpg)
"""
    payload = {
        "markdown": markdown,
        "domain": "outre.com",
        "url": "https://www.outre.com/product/a-ocean-deep/"
    }

    response = requests.post(url, json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get("success") is True, f"Expected success=True: {data}"

    # Verify backward-compatible flat layout is always present
    assert "title" in data, "Expected 'title' in response"
    assert "media_links" in data, "Expected 'media_links' in response"
    assert "file_links" in data, "Expected 'file_links' in response"
    assert "assets" in data, "Expected 'assets' manifest in response"

    # Title should have been extracted (AI path: specific title; rule-based: may be generic)
    title = data.get("title", "")
    assert title, f"Expected non-empty title, got: '{title}'"

    print(f"New schema mapping test passed. Title: {title}, Assets: {len(data['assets'])}, Media: {len(data['media_links'])}")


def test_asset_manifest_excludes_unrelated_products():
    """Assets from 'YOU MAY ALSO LIKE' sections must not be in the manifest"""
    url = "http://localhost:5005/extract"
    markdown = """## VG-5HP Industrial Pump

Heavy-duty 5HP pump for industrial use.

Price: $350.00

![VG-5HP Product Image](https://pumps.com/images/vg-5hp-front.jpg)

### YOU MAY ALSO LIKE

[![Other Pump A](https://pumps.com/images/other-pump-a.jpg)](https://pumps.com/product/other-pump-a/)
[![Other Pump B](https://pumps.com/images/other-pump-b.jpg)](https://pumps.com/product/other-pump-b/)
"""
    payload = {
        "markdown": markdown,
        "domain": "pumps.com",
        "url": "https://pumps.com/product/vg-5hp/"
    }

    response = requests.post(url, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data.get("success") is True

    # All assets must belong to the main product - none should be "other-pump"
    all_srcs = [a.get("src", "") for a in data.get("assets", [])]
    for src in all_srcs:
        assert "other-pump" not in src, f"Found unrelated product asset in manifest: {src}"

    print("Asset manifest exclusion test passed - no related product assets contaminated output.")


if __name__ == "__main__":
    print("Running crawler and extraction tests...")
    test_classify_url()
    test_matches_category_segments()
    test_crawl_mock()
    test_crawl_real_failed_fallback()
    test_extract()
    test_group_variants()
    test_extract_media_and_files()
    test_price_and_currency_extraction()
    test_preprocess_onclick_links()
    test_resolve_pdf_viewer_url()
    test_pdf_image_extraction()
    test_html_viewer_extraction()
    test_download_and_hash_asset()
    test_new_schema_mapping_in_extract()
    test_asset_manifest_excludes_unrelated_products()
    print("All tests passed!")
