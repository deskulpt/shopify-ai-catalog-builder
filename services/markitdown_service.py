from flask import Flask, request, jsonify
from markitdown import MarkItDown
import os
import tempfile
import requests as http
import urllib.parse
import json
import re
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

UNIT_PATTERNS = [
    (r'(\d+(?:\.\d+)?)\s*(?:kg|kilogram|kilograms)', 'KG', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:g|gram|grams)', 'G', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)', 'LB', 'imperial'),
    (r'(\d+(?:\.\d+)?)\s*(?:oz|ounces)', 'OZ', 'imperial'),
    (r'(\d+(?:\.\d+)?)\s*(?:l|liter|liters)', 'L', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:ml|milliliter|milliliters)', 'ML', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)', 'MM', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:cm|centimeter|centimeters)', 'CM', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:m|meter|meters)', 'M', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")', 'IN', 'imperial'),
    (r'(\d+(?:\.\d+)?)\s*(?:hp|horsepower)', 'HP', 'imperial'),
    (r'(\d+(?:\.\d+)?)\s*(?:v|volt|volts|voltage)', 'V', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:w|watt|watts)', 'W', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:kw|kilowatt|kilowatts)', 'KW', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:a|amp|amps|ampere|amperes)', 'A', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:ah)', 'AH', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:hz|hertz)', 'HZ', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:psi)', 'PSI', 'imperial'),
    (r'(\d+(?:\.\d+)?)\s*(?:bar|bars)', 'BAR', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:°c|c|celsius)', '°C', 'metric'),
    (r'(\d+(?:\.\d+)?)\s*(?:°f|f|fahrenheit)', '°F', 'imperial'),
]

def parse_specification_unit(name, raw_value):
    val_str = str(raw_value).strip().lower()
    
    # Check for dimensions (e.g. 10 x 5 x 3 cm)
    dim_match = re.search(r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(cm|mm|m|in|inch|")', val_str)
    if dim_match:
        try:
            val1 = float(dim_match.group(1))
            val2 = float(dim_match.group(2))
            val3 = float(dim_match.group(3)) if dim_match.group(3) else None
            
            v1_str = str(int(val1) if val1.is_integer() else val1)
            v2_str = str(int(val2) if val2.is_integer() else val2)
            v3_str = str(int(val3) if val3.is_integer() else val3) if val3 is not None else None
            
            unit = dim_match.group(4).upper()
            if unit == '"' or unit == 'INCH' or unit == 'INCHES':
                unit = 'IN'
            system = 'metric' if unit in ['CM', 'MM', 'M'] else 'imperial'
            return {
                "name": name,
                "rawValue": raw_value,
                "value": f"{v1_str}x{v2_str}x{v3_str}" if v3_str else f"{v1_str}x{v2_str}",
                "unit": unit,
                "system": system
            }
        except:
            pass

    for pattern, std_unit, system in UNIT_PATTERNS:
        match = re.search(pattern, val_str)
        if match:
            try:
                numeric_val = float(match.group(1))
                numeric_val = int(numeric_val) if numeric_val.is_integer() else numeric_val
                return {
                    "name": name,
                    "rawValue": raw_value,
                    "value": numeric_val,
                    "unit": std_unit,
                    "system": system
                }
            except ValueError:
                pass
                
    return {
        "name": name,
        "rawValue": raw_value,
        "value": raw_value,
        "unit": None,
        "system": None
    }

def rule_based_extract(markdown):
    lines = markdown.split('\n')
    title = "Industrial Product"
    sku = None
    purchase_type = "direct_buy"
    short_description = ""
    specifications = []
    
    # Find Title (First # header)
    for line in lines:
        if line.strip().startswith('# '):
            title = line.replace('# ', '').strip()
            break
        elif line.strip().startswith('## '):
            title = line.replace('## ', '').strip()
            break

    # Look for SKU / Model
    for line in lines:
        match = re.search(r'(?:sku|model|part number|p/n):\s*([a-zA-Z0-9\-_]+)', line, re.IGNORECASE)
        if match:
            sku = match.group(1).strip()
            break
            
    if not sku:
        # Fallback to look for typical uppercase SKU pattern
        for line in lines:
            words = line.split()
            for w in words:
                w_clean = w.strip(',.:;|()[]{}')
                if re.match(r'^[A-Z0-9]{3,5}-[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$', w_clean) or re.match(r'^[A-Z]{2,4}-[0-9]{2,4}[A-Z]?$', w_clean):
                    sku = w_clean
                    break
            if sku:
                break
                
    # Detect Purchase Type
    purchase_terms = ["quote", "rfq", "request a quote", "price on request", "call for price", "contact us for pricing", "enquire", "inquire"]
    for line in lines:
        if any(term in line.lower() for term in purchase_terms):
            purchase_type = "quote_only"
            break
            
    # Extract Specifications from lists and tables
    # 1. Lists: - Key: Value
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('- ') or stripped.startswith('* '):
            content = stripped[2:].strip()
            if ':' in content:
                key, val = content.split(':', 1)
                key = key.strip()
                val = val.strip()
                if len(key) < 30 and len(val) < 100 and not any(x in key.lower() for x in ["sku", "model", "http"]):
                    specifications.append(parse_specification_unit(key, val))
                    
    # 2. Tables: | Key | Value |
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|'):
            cells = [c.strip() for c in stripped.split('|')[1:-1]]
            if len(cells) == 2:
                key, val = cells
                if key and val and not all(c == '-' for c in key) and not all(c == '-' for c in val):
                    if not any(x in key.lower() for x in ["key", "specification", "value", "property", "sku", "model"]):
                        specifications.append(parse_specification_unit(key, val))
                        
    desc_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('#') and not stripped.startswith('|') and not stripped.startswith('-') and not stripped.startswith('*') and not stripped.startswith('!['):
            desc_lines.append(stripped)
            if len(desc_lines) >= 3:
                break
    short_description = " ".join(desc_lines)[:300]
    if not short_description:
        short_description = f"Industrial specifications sheet for {title}."

    return {
        "success": True,
        "title": title,
        "sku": sku or "GENERIC-SKU",
        "purchase_type": purchase_type,
        "short_description": short_description,
        "specifications": specifications
    }

@app.route('/extract', methods=['POST'])
def extract_product():
    """Extract structured product fields from Markdown content"""
    data = request.get_json() or {}
    markdown = data.get('markdown')
    domain = data.get('domain', '')
    
    if not markdown:
        return jsonify({'error': 'No Markdown content provided'}), 400
        
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            prompt = f"""
            Extract structured product fields from the following markdown document.
            Return a JSON object matching this schema:
            {{
                "title": "Product Title",
                "sku": "SKU code or null",
                "purchase_type": "direct_buy" or "quote_only",
                "short_description": "A 2-3 sentence overview description",
                "specifications": [
                    {{
                        "name": "Specification Name (e.g. Weight, Voltage, Material)",
                        "rawValue": "Original text value (e.g. 25KG, 24V DC)"
                    }}
                ]
            }}
            
            Markdown:
            {markdown}
            """
            
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.0
            )
            
            result = json.loads(response.choices[0].message.content)
            
            specs_normalized = []
            for spec in result.get("specifications", []):
                name = spec.get("name")
                raw_val = spec.get("rawValue")
                if name and raw_val:
                    specs_normalized.append(parse_specification_unit(name, raw_val))
            result["specifications"] = specs_normalized
            result["success"] = True
            return jsonify(result)
        except Exception:
            pass

    result = rule_based_extract(markdown)
    return jsonify(result)

def jaccard_similarity(str1, str2):
    s1 = set(w.strip('-(),.').lower() for w in str1.split() if len(w.strip('-(),.')) > 1)
    s2 = set(w.strip('-(),.').lower() for w in str2.split() if len(w.strip('-(),.')) > 1)
    if not s1 or not s2:
        return 0
    return len(s1.intersection(s2)) / len(s1.union(s2))

def longest_common_prefix_string(str1, str2):
    w1 = str1.split()
    w2 = str2.split()
    common = []
    for a, b in zip(w1, w2):
        if a.strip('-(),.').lower() == b.strip('-(),.').lower():
            common.append(a)
        else:
            break
    return " ".join(common)

def infer_variant_options(parent_title, variant_name):
    parent_clean = parent_title.lower().strip()
    var_clean = variant_name.lower().strip()
    
    diff = variant_name
    if parent_clean in var_clean:
        diff = variant_name[len(parent_title):].strip('- \t,()[]')
        
    if not diff:
        return {"Option": "Standard"}
        
    diff_lower = diff.lower()
    if 'volt' in diff_lower or re.search(r'\d+\s*v\b', diff_lower):
        return {"Voltage": diff}
    elif 'hp' in diff_lower or 'horsepower' in diff_lower or re.search(r'\d+\s*hp\b', diff_lower):
        return {"Power": diff}
    elif 'phase' in diff_lower or re.search(r'\b\d+\s*ph\b', diff_lower):
        return {"Phase": diff}
    elif any(x in diff_lower for x in ['inch', 'in', 'mm', 'cm', 'm', '"']):
        return {"Size": diff}
    elif any(x in diff_lower for x in ['red', 'blue', 'green', 'black', 'white', 'yellow', 'grey', 'gray']):
        return {"Color": diff}
    elif any(x in diff_lower for x in ['steel', 'brass', 'iron', 'plastic', 'copper', 'pvc', 'metal']):
        return {"Material": diff}
    else:
        return {"Model": diff}

@app.route('/group-variants', methods=['POST'])
def group_variants():
    """Group similar catalog products into parent products with variants"""
    data = request.get_json() or {}
    products = data.get('products', [])
    
    if not products:
        return jsonify({'success': True, 'grouped': []})
        
    clusters = []
    
    for prod in products:
        name = prod.get('name', '')
        url = prod.get('url', '')
        
        joined = False
        for cluster in clusters:
            rep_name = cluster[0]['name']
            similarity = jaccard_similarity(name, rep_name)
            common = longest_common_prefix_string(name, rep_name)
            
            if similarity >= 0.5 or (common and len(common.split()) >= 2):
                cluster.append(prod)
                joined = True
                break
                
        if not joined:
            clusters.append([prod])
            
    grouped_result = []
    
    for cluster in clusters:
        if len(cluster) == 1:
            prod = cluster[0]
            grouped_result.append({
                "title": prod['name'],
                "is_grouped": False,
                "variants": [prod]
            })
        else:
            parent_title = cluster[0]['name']
            for prod in cluster[1:]:
                parent_title = longest_common_prefix_string(parent_title, prod['name'])
                
            parent_title = parent_title.strip('- \t,()[]')
            if len(parent_title) < 5 or len(parent_title.split()) < 1:
                parent_title = cluster[0]['name']
                parent_title = re.sub(r'[- ]\d+v\b.*', '', parent_title, flags=re.IGNORECASE)
                parent_title = re.sub(r'[- ]\d+hp\b.*', '', parent_title, flags=re.IGNORECASE)
                parent_title = parent_title.strip()
                
            variants_list = []
            all_option_names = set()
            
            for prod in cluster:
                options_dict = infer_variant_options(parent_title, prod['name'])
                variants_list.append({
                    "name": prod['name'],
                    "url": prod['url'],
                    "option_values": options_dict
                })
                for k in options_dict.keys():
                    all_option_names.add(k)
                    
            grouped_result.append({
                "title": parent_title,
                "is_grouped": True,
                "options": list(all_option_names),
                "variants": variants_list
            })
            
    return jsonify({
        "success": True,
        "grouped": grouped_result
    })

@app.route('/health', methods=['GET'])
def health():
    """Service health check"""
    return jsonify({'status': 'ok', 'service': 'markitdown'})

if __name__ == '__main__':
    # Default to port 5005
    port = int(os.environ.get('PORT', 5005))
    app.run(port=port, host='0.0.0.0', debug=True)
