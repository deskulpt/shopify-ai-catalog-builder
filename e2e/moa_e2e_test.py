"""
moa_e2e_test.py
━━━━━━━━━━━━━━━━━━
End-to-end test for the AI Scraper MOA pipeline.
Tests all endpoints individually and the integrated batch flow.

Run: python3 moa_e2e_test.py
Or:  ../.venv/bin/python3 moa_e2e_test.py
"""

import requests
import json
import sys
import os
import time

SERVICE_URL = "http://localhost:5005"
PASS = 0
FAIL = 0
ERRORS = []


def test(name, fn):
    """Run a test case, print result, and tally."""
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print(f"  ✅ {name}")
    except AssertionError as e:
        FAIL += 1
        msg = str(e)
        print(f"  ❌ {name}: {msg}")
        ERRORS.append(f"{name}: {msg}")
    except Exception as e:
        FAIL += 1
        msg = f"EXCEPTION: {e}"
        print(f"  ❌ {name}: {msg}")
        ERRORS.append(f"{name}: {msg}")


def assert_eq(a, b, msg=""):
    if a != b:
        raise AssertionError(f"Expected {b!r}, got {a!r}. {msg}")


def assert_in(needle, haystack, msg=""):
    if needle not in haystack:
        raise AssertionError(f"Expected {needle!r} in {str(haystack)[:200]}. {msg}")


# ═══════════════════════════════════════════════════════════════════════════════
# TEST SUITE
# ═══════════════════════════════════════════════════════════════════════════════

def test_health():
    """1. Service health check"""
    resp = requests.get(f"{SERVICE_URL}/health", timeout=5)
    data = resp.json()
    assert_eq(resp.status_code, 200)
    assert_eq(data["status"], "ok")
    assert_eq(data["service"], "markitdown")


def test_convert_url():
    """2. URL conversion to markdown (skip if network unavailable)"""
    resp = requests.post(
        f"{SERVICE_URL}/convert-url",
        json={"url": "https://example.com"},
        timeout=15,
    )
    if resp.status_code == 500:
        print(f"  (skipped - network unavailable: {resp.json().get('error', '')[:80]}...)")
        return
    data = resp.json()
    assert_eq(resp.status_code, 200)
    assert_eq(data.get("success"), True)
    assert data.get("markdown"), "Expected non-empty markdown"


def test_crawl_mock():
    """3. Crawl mock website"""
    resp = requests.post(
        f"{SERVICE_URL}/crawl",
        json={"url": "https://mock-vendor.com"},
        timeout=15,
    )
    data = resp.json()
    assert_eq(data["success"], True)
    assert_eq(data["domain"], "mock-vendor.com")
    assert_eq(data["mocked"], True)
    assert len(data["categories"]) > 0
    # Check first category structure
    cat = data["categories"][0]
    assert_in("name", cat)
    assert_in("products", cat)
    assert len(cat["products"]) > 0


def test_classify_url():
    """4. URL classification logic"""
    from markitdown_service import classify_url, matches_category_segments

    # Root domain
    assert_eq(
        classify_url("https://www.outre.com", "Home", "outre.com"),
        "root",
    )
    assert_eq(
        classify_url("https://www.outre.com/", "Home", "outre.com"),
        "root",
    )

    # Category paths
    assert_eq(
        classify_url(
            "https://www.outre.com/product-category/braids",
            "Braids",
            "outre.com",
        ),
        "category",
    )
    assert_eq(
        classify_url(
            "https://www.outre.com/category/hair",
            "Hair",
            "outre.com",
        ),
        "category",
    )

    # Product paths
    assert_eq(
        classify_url(
            "https://www.outre.com/product/type-4-soft-natural-frappe-18-3x/",
            "Type 4 Soft Natural",
            "outre.com",
        ),
        "product",
    )

    # Custom patterns override
    patterns = {
        "product": ["/item-detail/"],
        "category": ["/list-view/"],
    }
    assert_eq(
        classify_url(
            "https://www.outre.com/item-detail/hair-123",
            "Hair Product",
            "outre.com",
            patterns=patterns,
        ),
        "product",
    )

    # Category segments match
    assert matches_category_segments(
        "https://www.sensationnel.com/product-category/weave/weaves-human-hair/",
        "https://www.sensationnel.com/product/weave/weaves-human-hair/some-product/",
    ), "Expected matching category segments"
    
    # Non-matching paths
    assert not matches_category_segments(
        "https://www.sensationnel.com/product-category/wig/",
        "https://www.sensationnel.com/product/weave/some-item/",
    ), "Expected non-matching category segments"


def test_extract_single_product():
    """5. Single product extraction"""
    markdown = """# High Pressure Pump Model VG-5HP
SKU: VG-5HP-24V
Price: $299.00

Specifications:
- Weight: 25KG
- Input Voltage: 24V DC
- Dimensions: 12 x 8 x 5 cm
- Material: Stainless Steel
"""
    resp = requests.post(
        f"{SERVICE_URL}/extract",
        json={"markdown": markdown, "domain": "pumps.com"},
        timeout=30,
    )
    data = resp.json()
    assert_eq(data["success"], True)
    assert "VG-5HP" in data.get("title", "")
    assert_eq(data["sku"], "VG-5HP-24V")
    assert data.get("specifications"), "Expected specifications"
    assert len(data["specifications"]) >= 4


def test_extract_price_currency():
    """6. Price and currency extraction"""
    tests = [
        ("₹ 22 / Piece", 22.0, "INR", "Piece"),
        ("Price: $ 4.50 per Meter", 4.50, "USD", "Meter"),
        ("CAD 120.00 each", 120.0, "CAD", "each"),
        ("Rate: £15 per unit", 15.0, "GBP", "unit"),
        ("Price: 12,500 € each", 12500.0, "EUR", "each"),
        ("Price: ¥ 1,200 / roll", 1200.0, "JPY", "roll"),
    ]

    for md_text, expected_price, expected_curr, expected_unit in tests:
        resp = requests.post(
            f"{SERVICE_URL}/extract",
            json={"markdown": f"### Test Product\n{md_text}\nSize: Large"},
            timeout=15,
        )
        data = resp.json()
        assert_eq(data["success"], True)
        
        # Price as float for comparison
        price_str = str(data.get("price", "0")).replace(",", "").strip()
        try:
            price_val = float(price_str)
        except (ValueError, TypeError):
            price_val = None
        
        assert_eq(price_val, expected_price, f"For text: {md_text}")
        assert_eq(data.get("currency"), expected_curr, f"For text: {md_text}")
        assert_eq(data.get("price_unit"), expected_unit, f"For text: {md_text}")


def test_extract_media_files():
    """7. Media and file link extraction"""
    markdown = """### High Pressure Pump Model VG-5HP
Here is a picture of the pump:
![VG-5HP front view](/images/vg-5hp-front.jpg)
And another detail shot:
![](https://pumps.com/vg-5hp-side.png)

Specifications:
- Insulation Material: PVC
- Conductor Material: Copper

Documents:
- [Instruction Manual](/downloads/manual.pdf)
- [General Catalog](https://pumps.com/catalog.zip)
"""
    resp = requests.post(
        f"{SERVICE_URL}/extract",
        json={
            "markdown": markdown,
            "domain": "pumps.com",
            "url": "https://pumps.com/products/vg-5hp",
        },
        timeout=15,
    )
    data = resp.json()
    assert_eq(data["success"], True)

    media = data.get("media_links", [])
    assert len(media) >= 2, f"Expected at least 2 media links, got {len(media)}"

    files = data.get("file_links", [])
    assert len(files) >= 2, f"Expected at least 2 file links, got {len(files)}"


def test_group_variants():
    """8. Variant grouping"""
    products = [
        {"name": "Industrial AC Motor 5HP - 110V", "url": "https://motors.com/ac-5hp-110v"},
        {"name": "Industrial AC Motor 5HP - 220V", "url": "https://motors.com/ac-5hp-220v"},
        {"name": "High-Pressure Control Valve 1/2\"", "url": "https://motors.com/valve-half"},
    ]
    resp = requests.post(
        f"{SERVICE_URL}/group-variants",
        json={"products": products},
        timeout=15,
    )
    data = resp.json()
    assert_eq(data["success"], True)

    grouped = data["grouped"]
    assert len(grouped) == 2

    motor_group = next(g for g in grouped if g["is_grouped"])
    assert_eq(motor_group["title"], "Industrial AC Motor 5HP")
    assert len(motor_group["variants"]) == 2
    assert_in("Voltage", motor_group.get("options", []))

    valve_group = next(g for g in grouped if not g["is_grouped"])
    assert_eq(valve_group["title"], 'High-Pressure Control Valve 1/2"')
    assert len(valve_group["variants"]) == 1


def test_moa_extract_single():
    """9. MOA-enhanced single extraction"""
    markdown = """# Heavy Duty Slurry Pump 10HP
SKU: SP-10HP-900
Price: Request a quote

Specifications:
- Power: 10 HP
- Diameter: 4 inch
- Material: Stainless Steel
- Voltage: 10-30VDC
"""
    resp = requests.post(
        f"{SERVICE_URL}/moa-extract",
        json={
            "markdown": markdown,
            "domain": "pumps.com",
            "url": "https://pumps.com/product/slurry-10hp",
        },
        timeout=15,
    )
    data = resp.json()
    assert_eq(data["success"], True)
    assert_in("Slurry", data.get("title", ""))
    assert_in("SP-10HP", data.get("sku", ""))
    assert data.get("specifications"), "Expected specifications"


def test_moa_extract_batch():
    """10. MOA-enhanced batch extraction"""
    products = [
        {
            "id": "p1",
            "markdown": "# Centrifugal Pump 5HP\nSKU: CP-5HP-100\nPrice: $599.00\n- Diameter: 3 inch\n- Material: Cast Iron",
            "url": "https://pumps.com/centrifugal-5hp",
        },
        {
            "id": "p2",
            "markdown": "# Brass Ball Valve 1/2\"\nSKU: VLV-BB-050\nPrice: $24.95\n- Size: 1/2 inch\n- Material: Nickel Plated Brass",
            "url": "https://pumps.com/ball-valve",
        },
    ]
    resp = requests.post(
        f"{SERVICE_URL}/moa-extract",
        json={"products": products, "domain": "pumps.com"},
        timeout=15,
    )
    data = resp.json()
    assert_eq(data["success"], True)
    assert_eq(data["batch"], True)
    assert_eq(data["count"], 2)

    for prod in data["products"]:
        assert prod.get("title"), f"Product {prod.get('_source_id')} missing title"
        assert prod.get("sku"), f"Product {prod.get('_source_id')} missing SKU"
        assert prod.get("success"), f"Product {prod.get('_source_id')} not successful"


def test_full_pipeline():
    """11. End-to-end pipeline: crawl → extract → group → MOA-enrich"""
    # Step 1: Crawl
    crawl_resp = requests.post(
        f"{SERVICE_URL}/crawl",
        json={"url": "https://mock-vendor.com"},
        timeout=15,
    )
    crawl_data = crawl_resp.json()
    assert_eq(crawl_data["success"], True)
    assert len(crawl_data["categories"]) > 0

    # Step 2: Collect products from first category
    cat = crawl_data["categories"][0]
    products_to_extract = cat["products"][:3]  # Top 3 products

    # Step 3: MOA batch extract
    moa_products = [
        {
            "id": p.get("url", f"idx_{i}"),
            "markdown": f"# {p['name']}\nSKU: {p.get('name', '').upper().replace(' ', '-')[:12]}\nPrice: $49.99\n- Category: {cat['name']}",
            "url": p.get("url", ""),
        }
        for i, p in enumerate(products_to_extract)
    ]

    moa_resp = requests.post(
        f"{SERVICE_URL}/moa-extract",
        json={"products": moa_products, "domain": "mock-vendor.com"},
        timeout=30,
    )
    moa_data = moa_resp.json()
    assert_eq(moa_data["success"], True)
    assert_eq(moa_data["count"], len(products_to_extract))

    # Step 4: Group variants
    group_products = [
        {"name": p["name"], "url": p.get("url", "")}
        for p in products_to_extract
    ]
    group_resp = requests.post(
        f"{SERVICE_URL}/group-variants",
        json={"products": group_products},
        timeout=15,
    )
    group_data = group_resp.json()
    assert_eq(group_data["success"], True)
    assert len(group_data["grouped"]) > 0

    print(f"  Full pipeline: crawled {len(products_to_extract)} products → "
          f"MOA extracted {moa_data['count']} → "
          f"grouped into {len(group_data['grouped'])} clusters")


# ═══════════════════════════════════════════════════════════════════════════════
# RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    global PASS, FAIL, ERRORS
    print("=" * 60)
    print("  AI Scraper MOA E2E Test Suite")
    print(f"  Service: {SERVICE_URL}")
    print("=" * 60)
    print()

    # First check if service is up
    try:
        requests.get(f"{SERVICE_URL}/health", timeout=3)
        print("✓ Python service is running\n")
    except requests.ConnectionError:
        print("✗ Python service is NOT running!")
        print(f"  Start with: cd .. && .venv/bin/python3 services/markitdown_service.py")
        sys.exit(1)

    # Run all tests
    tests = [
        ("Health check", test_health),
        ("URL conversion", test_convert_url),
        ("Crawl mock website", test_crawl_mock),
        ("URL classification", test_classify_url),
        ("Single product extraction", test_extract_single_product),
        ("Price/currency extraction", test_extract_price_currency),
        ("Media/file extraction", test_extract_media_files),
        ("Variant grouping", test_group_variants),
        ("MOA single extraction", test_moa_extract_single),
        ("MOA batch extraction", test_moa_extract_batch),
        ("Full pipeline E2E", test_full_pipeline),
    ]

    for name, fn in tests:
        print(f"  ── {name} ──")
        test(name, fn)

    # Summary
    print()
    print("=" * 60)
    total = PASS + FAIL
    print(f"  Results: {PASS}/{total} passed", end="")
    if FAIL > 0:
        print(f", {FAIL} failed")
        print()
        for err in ERRORS:
            print(f"  ! {err}")
    else:
        print()
    print("=" * 60)

    return FAIL == 0


if __name__ == "__main__":
    # Add the services directory to path for import-based tests
    script_dir = os.path.dirname(os.path.abspath(__file__))
    services_dir = os.path.join(os.path.dirname(script_dir), "services")
    sys.path.insert(0, services_dir)
    
    success = main()
    sys.exit(0 if success else 1)
