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
    assert data["title"] == "High Pressure Pump Model VG-5HP"
    
    # Verify specifications do not contain base64 image data
    specs = data.get("specifications", [])
    assert len(specs) > 0
    assert not any("data:image" in str(s) for s in specs)
    assert not any("base64" in str(s) for s in specs)
    
    # Verify image extraction and relative URL resolution
    media = data.get("media_links", [])
    assert len(media) == 2
    
    assert media[0]["url"] == "https://pumps.com/images/vg-5hp-front.jpg"
    assert media[0]["alt"] == "VG-5HP front view"
    
    assert media[1]["url"] == "https://pumps.com/vg-5hp-side.png"
    assert media[1]["alt"] == ""
    
    # Verify file links extraction and resolution
    files = data.get("file_links", [])
    assert len(files) == 3
    
    assert files[0]["url"] == "https://pumps.com/downloads/manual.pdf"
    assert files[0]["text"] == "Instruction Manual"
    
    assert files[1]["url"] == "https://pumps.com/products/wiring.pdf"
    assert files[1]["text"] == "Wiring Diagram"
    
    assert files[2]["url"] == "https://pumps.com/catalog.zip"
    assert files[2]["text"] == "General Catalog"
    
    print("Media and File Extraction/Resolution test passed successfully!")

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
    assert data1["price"] == "22"
    assert data1["currency"] == "INR"
    assert data1["price_unit"] == "Piece"
    
    # 2. Test Dollar and meter
    markdown2 = """### Flexible Conduit Pipe
Price: $ 4.50 per Meter
Color: Black
"""
    response2 = requests.post(url, json={"markdown": markdown2})
    assert response2.status_code == 200
    data2 = response2.json()
    assert data2["price"] == "4.50"
    assert data2["currency"] == "USD"
    assert data2["price_unit"] == "Meter"

    # 3. Test CAD and each
    markdown3 = """### Control Switch Box
CAD 120.00 each
"""
    response3 = requests.post(url, json={"markdown": markdown3})
    assert response3.status_code == 200
    data3 = response3.json()
    assert data3["price"] == "120.00"
    assert data3["currency"] == "CAD"
    assert data3["price_unit"] == "each"

    # 4. Test GBP
    markdown4 = """### Temperature Sensor
Rate: £15 per unit
"""
    response4 = requests.post(url, json={"markdown": markdown4})
    assert response4.status_code == 200
    data4 = response4.json()
    assert data4["price"] == "15"
    assert data4["currency"] == "GBP"
    assert data4["price_unit"] == "unit"
    
    # 5. Test EUR and commas
    markdown5 = """### Large Hydraulic Press
Price: 12,500 € each
"""
    response5 = requests.post(url, json={"markdown": markdown5})
    assert response5.status_code == 200
    data5 = response5.json()
    assert data5["price"] == "12500"
    assert data5["currency"] == "EUR"
    assert data5["price_unit"] == "each"

    # 6. Test Yen and commas
    markdown6 = """### Cable Jointing Kit
Price: ¥ 1,200 / roll
"""
    response6 = requests.post(url, json={"markdown": markdown6})
    assert response6.status_code == 200
    data6 = response6.json()
    assert data6["price"] == "1200"
    assert data6["currency"] == "JPY"
    assert data6["price_unit"] == "roll"
    
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

if __name__ == "__main__":
    print("Running crawler and extraction tests...")
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
    print("All tests passed!")
