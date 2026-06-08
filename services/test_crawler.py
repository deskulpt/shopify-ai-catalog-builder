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

if __name__ == "__main__":
    print("Running crawler tests...")
    test_crawl_mock()
    test_crawl_real_failed_fallback()
    print("All tests passed!")
