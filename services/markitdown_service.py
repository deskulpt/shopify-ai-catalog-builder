from flask import Flask, request, jsonify
from markitdown import MarkItDown
import os
import tempfile
import requests as http
import urllib.parse
import json
from bs4 import BeautifulSoup

app = Flask(__name__)
md = MarkItDown()

@app.route('/convert', methods=['POST'])
def convert_file():
    """Convert uploaded file to Markdown"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Securely write to a temporary file preserving extension
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name
    
    try:
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/convert-url', methods=['POST'])
def convert_url():
    """Convert URL content to Markdown"""
    data = request.get_json() or {}
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    
    try:
        # Fetch the URL content
        response = http.get(url, timeout=30)
        response.raise_for_status()
        
        # Determine likely file suffix based on content type or url extension
        suffix = '.html'
        if '.' in url.split('/')[-1]:
            url_ext = os.path.splitext(url.split('/')[-1])[1]
            if len(url_ext) <= 5: # reasonable file extension length
                suffix = url_ext
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

def get_mock_taxonomy(domain):
    return {
        "success": True,
        "domain": domain,
        "robots": {
            "sitemaps": [f"https://{domain}/sitemap.xml"],
            "crawl_delay": 1
        },
        "llms_txt": f"# {domain} Catalog\n\nThis is a mock LLM discovery file for {domain}.\nWe offer high quality industrial components including pumps, motors, and pneumatic valves.",
        "categories": [
            {
                "name": "Industrial Pumps",
                "url": f"https://{domain}/collections/pumps",
                "product_count": 4,
                "products": [
                    { "name": "Centrifugal Pump 5HP (Direct Buy)", "url": f"https://{domain}/products/pumps/centrifugal-5hp" },
                    { "name": "Heavy Duty Slurry Pump 10HP (Quote Only)", "url": f"https://{domain}/products/pumps/slurry-10hp" },
                    { "name": "Submersible Effluent Pump 2HP", "url": f"https://{domain}/products/pumps/submersible-2hp" },
                    { "name": "High-Pressure Diaphragm Pump (Quote Only)", "url": f"https://{domain}/products/pumps/diaphragm-high" }
                ]
            },
            {
                "name": "Electric Motors",
                "url": f"https://{domain}/collections/motors",
                "product_count": 3,
                "products": [
                    { "name": "Three-Phase AC Induction Motor 15HP (Quote Only)", "url": f"https://{domain}/products/motors/three-phase-15hp" },
                    { "name": "Single-Phase General Purpose Motor 1HP", "url": f"https://{domain}/products/motors/single-phase-1hp" },
                    { "name": "Explosion Proof Motor 20HP (Quote Only)", "url": f"https://{domain}/products/motors/explosion-proof-20hp" }
                ]
            },
            {
                "name": "Control Valves",
                "url": f"https://{domain}/collections/valves",
                "product_count": 3,
                "products": [
                    { "name": "High-Pressure Brass Ball Valve 1/2\"", "url": f"https://{domain}/products/valves/ball-valve-half" },
                    { "name": "Pneumatic Flow Control Valve 2\" (Quote Only)", "url": f"https://{domain}/products/valves/pneumatic-2in" },
                    { "name": "Solenoid Water Valve 24V", "url": f"https://{domain}/products/valves/solenoid-24v" }
                ]
            }
        ],
        "mocked": True
    }

@app.route('/crawl', methods=['POST'])
def crawl_site():
    """Crawl a website to discover structure (sitemaps, robots, llms.txt, categories, products)"""
    data = request.get_json() or {}
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
        
    parsed_url = urllib.parse.urlparse(url)
    domain = parsed_url.netloc
    
    # Standardize URL schema if missing
    if not parsed_url.scheme:
        url = "https://" + url
        parsed_url = urllib.parse.urlparse(url)
        domain = parsed_url.netloc
        
    # Check if mock domain is requested or invalid
    if "mock" in domain or "example" in domain or "test" in domain or not domain:
        return jsonify(get_mock_taxonomy(domain or "mock-vendor.com"))
        
    try:
        # 1. Fetch robots.txt
        robots_url = f"{parsed_url.scheme}://{domain}/robots.txt"
        sitemaps = []
        crawl_delay = None
        try:
            r_robots = http.get(robots_url, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            if r_robots.status_code == 200:
                for line in r_robots.text.split('\n'):
                    if line.lower().startswith('sitemap:'):
                        sitemaps.append(line.split(':', 1)[1].strip())
                    elif line.lower().startswith('crawl-delay:'):
                        try:
                            crawl_delay = int(line.split(':', 1)[1].strip())
                        except:
                            pass
        except Exception:
            pass
            
        if not sitemaps:
            sitemaps.append(f"{parsed_url.scheme}://{domain}/sitemap.xml")
            
        # 2. Fetch llms.txt
        llms_url = f"{parsed_url.scheme}://{domain}/llms.txt"
        llms_txt = None
        try:
            r_llms = http.get(llms_url, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            if r_llms.status_code == 200:
                llms_txt = r_llms.text[:2000]
        except Exception:
            pass
            
        # 3. Parse Sitemaps
        discovered_products = []
        discovered_categories = []
        sitemap_parsed = False
        
        for sitemap in sitemaps:
            try:
                r_sm = http.get(sitemap, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
                if r_sm.status_code == 200:
                    soup = BeautifulSoup(r_sm.content, "xml")
                    locs = [loc.text for loc in soup.find_all("loc")]
                    if locs:
                        sitemap_parsed = True
                        for l in locs:
                            l_parsed = urllib.parse.urlparse(l)
                            path = l_parsed.path.lower()
                            # categorize based on path keywords
                            if any(k in path for k in ['/category/', '/c/', '/collection', '/catalog/', '/department/']):
                                name = path.split('/')[-1].replace('-', ' ').replace('_', ' ').title()
                                if not name and len(path.split('/')) > 2:
                                    name = path.split('/')[-2].replace('-', ' ').replace('_', ' ').title()
                                discovered_categories.append({"name": name or "Category", "url": l, "products": []})
                            elif any(k in path for k in ['/product/', '/p/', '/item/', '/pd/']) or (path.endswith('.html') and not any(k in path for k in ['index', 'contact', 'about'])):
                                name = path.split('/')[-1].replace('.html', '').replace('-', ' ').replace('_', ' ').title()
                                discovered_products.append({"name": name or "Product", "url": l})
            except Exception:
                pass
                
        # 4. Fetch Homepage and parse links/schema
        if not sitemap_parsed or len(discovered_products) == 0:
            try:
                r_home = http.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
                if r_home.status_code == 200:
                    soup = BeautifulSoup(r_home.content, "html.parser")
                    
                    # Look for schema.org JSON-LD
                    schema_tags = soup.find_all("script", type="application/ld+json")
                    for s in schema_tags:
                        try:
                            s_data = json.loads(s.string)
                            if isinstance(s_data, dict):
                                if s_data.get("@type") == "ItemList":
                                    for item in s_data.get("itemListElement", []):
                                        if isinstance(item, dict) and "url" in item:
                                            discovered_products.append({"name": item.get("name", "Product"), "url": item["url"]})
                        except:
                            pass
                            
                    # Scan normal anchors
                    anchors = soup.find_all("a", href=True)
                    for a in anchors:
                        href = a["href"]
                        full_href = urllib.parse.urljoin(url, href)
                        if urllib.parse.urlparse(full_href).netloc != domain:
                            continue
                        text = a.get_text().strip()
                        path = urllib.parse.urlparse(full_href).path.lower()
                        if not text or len(text) < 2:
                            continue
                        
                        if any(k in path for k in ['/category/', '/c/', '/collection', '/catalog/']):
                            if not any(cat["url"] == full_href for cat in discovered_categories):
                                discovered_categories.append({"name": text, "url": full_href, "products": []})
                        elif any(k in path for k in ['/product/', '/p/', '/item/']):
                            if not any(p["url"] == full_href for p in discovered_products):
                                discovered_products.append({"name": text, "url": full_href})
            except Exception:
                pass
                
        # Organize discovered products into categories
        if not discovered_categories and not discovered_products:
            mock_data = get_mock_taxonomy(domain or "mock-vendor.com")
            mock_data["warning"] = f"Could not reach {domain} or discover any products. Displaying fallback mock taxonomy."
            return jsonify(mock_data)

        if not discovered_categories:
            discovered_categories.append({"name": "General Products", "url": url, "products": []})
            
        for p in discovered_products:
            assigned = False
            for cat in discovered_categories:
                cat_path = urllib.parse.urlparse(cat["url"]).path.rstrip('/')
                if cat_path and cat_path in urllib.parse.urlparse(p["url"]).path:
                    cat["products"].append(p)
                    assigned = True
                    break
            if not assigned:
                discovered_categories[0]["products"].append(p)
                
        if len(discovered_categories) > 1:
            discovered_categories = [c for c in discovered_categories if c["products"]]
            if not discovered_categories:
                discovered_categories.append({"name": "General Products", "url": url, "products": discovered_products})
                
        for cat in discovered_categories:
            cat["product_count"] = len(cat["products"])
            
        return jsonify({
            "success": True,
            "domain": domain,
            "robots": {
                "sitemaps": sitemaps,
                "crawl_delay": crawl_delay
            },
            "llms_txt": llms_txt,
            "categories": discovered_categories,
            "mocked": False
        })
        
    except Exception as e:
        mock_data = get_mock_taxonomy(domain or "mock-vendor.com")
        mock_data["warning"] = f"Crawl failed ({str(e)}). Displaying fallback mock taxonomy."
        return jsonify(mock_data)

@app.route('/health', methods=['GET'])
def health():
    """Service health check"""
    return jsonify({'status': 'ok', 'service': 'markitdown'})

if __name__ == '__main__':
    # Default to port 5005
    port = int(os.environ.get('PORT', 5005))
    app.run(port=port, host='0.0.0.0', debug=True)
