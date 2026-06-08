import requests
import json

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
    
    # Verify Weight normalization
    weight_spec = next(s for s in specs if s["name"].lower() == "weight")
    assert weight_spec["value"] == 25.0
    assert weight_spec["unit"] == "KG"
    assert weight_spec["system"] == "metric"
    
    # Verify Voltage normalization
    volt_spec = next(s for s in specs if "voltage" in s["name"].lower())
    assert volt_spec["value"] == 24.0
    assert volt_spec["unit"] == "V"
    
    # Verify Dimensions normalization
    dim_spec = next(s for s in specs if "dimension" in s["name"].lower())
    assert dim_spec["value"] == "12x8x5"
    assert dim_spec["unit"] == "CM"
    assert dim_spec["system"] == "metric"
    
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

if __name__ == "__main__":
    print("Running crawler and extraction tests...")
    test_crawl_mock()
    test_crawl_real_failed_fallback()
    test_extract()
    test_group_variants()
    print("All tests passed!")
