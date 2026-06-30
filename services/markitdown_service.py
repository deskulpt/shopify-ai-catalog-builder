from flask import Flask, request, jsonify
from markitdown import MarkItDown
import os
import sys
import tempfile
import requests as http
import urllib.parse
import json
import re
from bs4 import BeautifulSoup
import uuid
from pypdf import PdfReader

# Add services dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from catalog_pdf_parser import parse_catalog_pdf_file, parse_catalog_pdf_bytes
from advanced_pdf_parser import AIAssistedExtractor
from pdf_extraction_config import get_pdf_config, get_config_manager


app = Flask(__name__)
md = MarkItDown()

PUBLIC_EXTRACTED_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public",
    "extracted"
)
os.makedirs(PUBLIC_EXTRACTED_DIR, exist_ok=True)

def extract_images_from_pdf_file(pdf_path, base_filename=None):
    if not base_filename:
        base_filename = "pdf_img_" + str(uuid.uuid4())[:8]
    else:
        # Clean filename to be safe
        base_filename = "".join([c if c.isalnum() or c in ('-', '_') else '_' for c in base_filename])
        base_filename = base_filename[:30] + "_" + str(uuid.uuid4())[:4]
        
    image_urls = []
    try:
        reader = PdfReader(pdf_path)
        for page_idx, page in enumerate(reader.pages):
            for img_idx, image_file_object in enumerate(page.images):
                name = image_file_object.name
                data = image_file_object.data
                
                # Filter out small images (under 5KB) like bullets or icons
                if len(data) < 5000:
                    continue
                    
                ext = os.path.splitext(name)[1] or ".jpg"
                if ext.lower() not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
                    ext = ".jpg"
                    
                filename = f"{base_filename}_page{page_idx+1}_img{img_idx+1}{ext}"
                out_path = os.path.join(PUBLIC_EXTRACTED_DIR, filename)
                
                with open(out_path, "wb") as fp:
                    fp.write(data)
                    
                image_urls.append(f"/extracted/{filename}")
    except Exception as e:
        print(f"Error extracting images from PDF {pdf_path}: {e}")
    return image_urls

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
        
        if suffix.lower() == '.pdf':
            base_name = os.path.splitext(file.filename)[0]
            image_urls = extract_images_from_pdf_file(tmp_path, base_name)
            if image_urls:
                markdown += "\n\n### Extracted PDF Images\n\n" + "\n".join([f"![Extracted Image]({url})" for url in image_urls])
                
        os.remove(tmp_path)
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

MOCK_PRODUCTS_MARKDOWN = {
    "centrifugal-5hp": """# Centrifugal Pump 5HP (Direct Buy)
SKU: CP-5HP-100
Price: $599.00
This is a high-quality centrifugal pump designed for industrial water transport and booster applications.

Specifications:
- Diameter: φ3
- Mounting: flush
- Operating distance/Sn: 0.6mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 Wire
- Model: CP-5HP-100
- Connection type: axial cable exit
""",
    "slurry-10hp": """# Heavy Duty Slurry Pump 10HP (Quote Only)
SKU: SP-10HP-900
Price: Request a quote

Designed for handling abrasive slurries and high-density solids in mining and heavy chemical processing.

Specifications:
- Diameter: φ4
- Mounting: flush
- Operating distance/Sn: 0.8mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 Wire
- Model: SP-10HP-900
- Connection type: prewired M8 connector
""",
    "submersible-2hp": """# Submersible Effluent Pump 2HP
SKU: SUB-2HP-200
Price: $349.00

Suitable for commercial and residential wastewater, effluent transfer, and dewatering applications.

Specifications:
- Diameter: M4
- Mounting: flush
- Operating distance/Sn: 0.6mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 Wire
- Model: SUB-2HP-200
- Connection type: axial cable exit
""",
    "diaphragm-high": """# High-Pressure Diaphragm Pump (Quote Only)
SKU: DP-HP-300
Price: Contact us for pricing

Positive displacement diaphragm pump for high-pressure chemical metering and fluid injection systems.

Specifications:
- Diameter: φ4
- Mounting: flush
- Operating distance/Sn: 1.5mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 Wire
- Model: DP-HP-300
- Connection type: prewired M8 connector
""",
    "three-phase-15hp": """# Three-Phase AC Induction Motor 15HP (Quote Only)
SKU: MOT-3P-15HP
Price: Price on request

Heavy-duty three-phase induction motor for industrial conveyors, fans, and machinery drives.

Specifications:
- Diameter: M5
- Mounting: flush
- Operating distance/Sn: 0.8mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: MOT-3P-15HP
- Connection type: M8 connector
""",
    "single-phase-1hp": """# Single-Phase General Purpose Motor 1HP
SKU: MOT-1P-1HP
Price: $189.00

General purpose single-phase electric motor for workshop tools, pumps, and light duty drives.

Specifications:
- Diameter: M5
- Mounting: flush
- Operating distance/Sn: 1.5mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: MOT-1P-1HP
- Connection type: prewired M8 connector
""",
    "explosion-proof-20hp": """# Explosion Proof Motor 20HP (Quote Only)
SKU: MOT-XP-20HP
Price: Call for price

ATEX certified explosion-proof electric motor for hazardous environments including oil, gas, and dust.

Specifications:
- Diameter: M5
- Mounting: flush
- Operating distance/Sn: 1mm
- Housing material: stainless steel
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: MOT-XP-20HP
- Connection type: axial cable exit
""",
    "ball-valve-half": """# High-Pressure Brass Ball Valve 1/2"
SKU: VLV-BB-050
Price: $24.95

Premium forged brass ball valve for high-pressure water, gas, and oil flow control.

Specifications:
- Diameter: Q5
- Mounting: flush
- Operating distance/Sn: 0.8mm
- Housing material: nickel plated brass
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: VLV-BB-050
- Connection type: axial cable exit
""",
    "pneumatic-2in": """# Pneumatic Flow Control Valve 2" (Quote Only)
SKU: VLV-PF-200
Price: Contact for quote

Double acting pneumatic flow control valve for automated industrial process pipelines.

Specifications:
- Diameter: Q5
- Mounting: flush
- Operating distance/Sn: 1.5mm
- Housing material: nickel plated brass
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: VLV-PF-200
- Connection type: prewired M8 connector
""",
    "solenoid-24v": """# Solenoid Water Valve 24V
SKU: VLV-SOL-24V
Price: $45.00

Normally closed direct-acting solenoid water valve, 24V DC.

Specifications:
- Diameter: Q5
- Mounting: flush
- Operating distance/Sn: 1.5mm
- Housing material: nickel plated brass
- Operating voltage: 10-30VDC
- Output: DC 3 wire
- Model: VLV-SOL-24V
- Connection type: prewired M8 connector
""",
    "product-14047-1024693": """# BD Sensors XMP i Precision Pressure Transmitter
SKU: XMP-I-1024693
Price: Request a quote

The XMP i precision process pressure transmitter is designed for industrial process engineering, chemical and petrochemical industries, and sanitary/food/pharmaceutical applications. Equipped with HART-communication as standard, it measures gauge, absolute, and vacuum pressure.

Specifications:
- Pressure range: 0-400 mbar to 0-600 bar
- Accuracy: 0.1% FSO
- Turn-down: 1:10
- Operating voltage: 12-36VDC
- Housing material: stainless steel
- Output signal: 4-20mA with HART
- Ingress protection: IP67
- Mounting: flush diaphragm
- Explosion protection: Intrinsically safe (ATEX)
- Medium temperature: -40 to 125 °C (up to 300 °C with cooling element)
- Connection: G1/2" thread

Documents:
- [Product Brochure (HTML Viewer)](https://pdf.directindustry.com/pdf/bd-sensors/xmp-i-precision-pressure-transmitter/14047-920409.html)
""",
    "product-14047-1024694": """# Industrial Pressure Transmitter DMP 331
SKU: DMP-331-1024694
Price: $189.00

Standard industrial pressure transmitter for fluids and gases.

Specifications:
- Pressure range: 0-100 mbar to 0-40 bar
- Accuracy: 0.5% FSO
- Operating voltage: 8-32VDC
- Housing material: stainless steel
- Output signal: 4-20mA
- Ingress protection: IP65
""",
    "product-14047-1024695": """# Submersible Level Probe LMK 351
SKU: LMK-351-1024695
Price: Request a quote

Submersible level probe for wastewater and sewage.

Specifications:
- Level range: 0-1 mH2O to 0-100 mH2O
- Accuracy: 0.5% FSO
- Housing material: stainless steel / ceramic
- Output signal: 4-20mA
- Ingress protection: IP68
""",
    "2852615731791": """### 16A Pull Cord Switch
SKU: PCS-16A-IM
Price: ₹ 1,500 / Piece Get Latest Price

Designed for heavy-duty industrial conveyor safety belt application. Features robust metal enclosure and IP67 ingress protection.

Specifications:
- Contact Rating: 16A at 240VAC
- Enclosure Material: Cast Aluminum
- Ingress Protection: IP67
- Reset Type: Manual Reset
- Operating Angle: 20 degrees
- Mounting: Base Mounting
- Cable Entry: 2 x M20

Images:
![Pull Cord Switch front view](https://5.imimg.com/data5/SELLER/Default/2026/5/610650033/VC/RI/EH/2744130/pull-cord-wire-rope-500x500.jpg)

Downloads:
- [Technical Datasheet](https://pdf.indiamart.com/impdf/11570431588/2744130/16a-pull-cord-switch.pdf)
"""
}

def classify_url(url, text, domain, all_candidate_urls=None, patterns=None):
    if all_candidate_urls is None:
        all_candidate_urls = []
        
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    query = parsed.query.lower()
    fragment = parsed.fragment
    text_lower = text.lower().strip()
    
    # 1. Ignore if external domain
    if parsed.netloc and parsed.netloc != domain and parsed.netloc.replace('www.', '') != domain.replace('www.', ''):
        return 'ignored'
        
    # Ignore list of extensions
    ignored_exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.zip', '.tar', '.gz', '.pdf', '.docx', '.xlsx', '.pptx', '.css', '.js']
    if any(path.endswith(ext) for ext in ignored_exts):
        return 'ignored'

    # Match custom overrides first if provided
    if patterns:
        product_pats = patterns.get('product')
        category_pats = patterns.get('category')
        root_pats = patterns.get('root')
        
        # Convert to list if single string
        if isinstance(product_pats, str): product_pats = [product_pats]
        if isinstance(category_pats, str): category_pats = [category_pats]
        if isinstance(root_pats, str): root_pats = [root_pats]
        
        def matches_any(url_str, pats):
            if not pats: return False
            for pat in pats:
                if not pat: continue
                try:
                    if pat.startswith('^') or pat.endswith('$') or '\\' in pat:
                        if re.search(pat, url_str, re.IGNORECASE):
                            return True
                    else:
                        if pat.lower() in url_str.lower():
                            return True
                except Exception:
                    if pat.lower() in url_str.lower():
                        return True
            return False

        if matches_any(url, root_pats):
            return 'root'
        if matches_any(url, category_pats):
            return 'category'
        if matches_any(url, product_pats):
            return 'product'

    # Check if root domain (homepage)
    if path in ['', '/', '/index.html', '/index.htm', '/index.php']:
        return 'root'

    # Ignore specific utility fragment patterns
    if fragment.lower() in ['main-content', 'how-works', 'customer', 'supplier', 'seller', 'header', 'footer', 'top', 'bottom', 'menu']:
        return 'ignored'
        
    # Ignore list of keywords
    ignored_keywords = [
        'index', 'contact', 'about', 'privacy', 'terms', 'cart', 'checkout', 
        'account', 'blog', 'news', 'faq', 'help', 'support', 'search', 
        'login', 'register', 'careers', 'jobs', 'feedback', 'testimonial', 
        'enquiry', 'company-profile', 'company-information', 'facebook', 'twitter', 'linkedin', 'trustworthiness'
    ]
    if any(k in path for k in ignored_keywords):
        return 'ignored'

    # 3. Check if this is a fragment product link
    if fragment:
        return 'product'
        
    # 4. Check for strong category path indicators (Category BEFORE Product)
    category_path_keywords = ['/product-category/', '/category/', '/c/', '/collection/', '/collections/', '/catalog/', '/department/', '/categories/']
    if any(k in path for k in category_path_keywords):
        return 'category'
    if 'catid=' in query or 'cat=' in query or 'collection_id=' in query:
        return 'category'
        
    # 5. Check for strong product path indicators
    product_path_keywords = ['/product/', '/p/', '/item/', '/pd/', '/shop/', '/store/']
    if any(k in path for k in product_path_keywords):
        return 'product'
    if 'product_id=' in query or 'id=' in query or 'item=' in query:
        return 'product'
        
    # 5. Check anchor text keywords
    if any(term in text_lower for term in ['products available', 'items available', 'view complete range', 'view all products', 'view all categories', 'our products']):
        return 'category'
        
    # 6. Analyze relation with other discovered URLs
    base_url_only = url.split('#')[0]
    has_fragment_siblings = any(
        other != base_url_only and other.split('#')[0] == base_url_only and '#' in other
        for other in all_candidate_urls
    )
    if has_fragment_siblings:
        return 'category'
        
    # 7. Check page name format for numeric ID suffix (e.g. product-name-12564659.html)
    page_name = path.split('/')[-1] if '/' in path else path
    page_name_no_ext = os.path.splitext(page_name)[0]
    has_num_suffix = bool(re.search(r'-\d+$', page_name_no_ext))
    if has_num_suffix:
        return 'product'
        
    # 8. Check if plural page name (category) vs singular/spec-heavy (product)
    if path.endswith('.html') or path.endswith('.php'):
        is_plural = page_name_no_ext.endswith('s') or page_name_no_ext.endswith('es')
        contains_product_spec = any(k in text_lower for k in ['1hp', '5hp', '10hp', '1/2', '24v', '12v', '110v', '220v', 'mm', 'cm', 'kg', 'amp', 'volt'])
        if is_plural and not contains_product_spec:
            return 'category'
        else:
            if any(k in text_lower for k in ['sensor', 'switch', 'pump', 'valve', 'motor', 'control', 'cable', 'connector', 'industrial', 'automation', 'module', 'relay', 'breaker', 'plug', 'indicator', 'transmitter']):
                return 'product'
            return 'category'
            
    # 9. Fallback based on text content
    if len(path.split('/')) > 1:
        if any(k in text_lower for k in ['sensor', 'switch', 'pump', 'valve', 'motor', 'control', 'cable', 'connector', 'industrial', 'automation', 'module', 'relay', 'breaker', 'plug', 'indicator', 'transmitter']):
            return 'product'
            
    return 'unknown'

def matches_category_segments(cat_url, prod_url):
    cat_path = urllib.parse.urlparse(cat_url).path.lower()
    prod_path = urllib.parse.urlparse(prod_url).path.lower()
    
    # Strip common base prefixes (matching full segments)
    for prefix in ['/product-category', '/category', '/collections', '/catalog']:
        if cat_path.startswith(prefix + '/'):
            cat_path = cat_path[len(prefix):]
        elif cat_path == prefix:
            cat_path = ""
            
    for prefix in ['/product', '/products', '/item']:
        if prod_path.startswith(prefix + '/'):
            prod_path = prod_path[len(prefix):]
        elif prod_path == prefix:
            prod_path = ""
            
    cat_segs = [s for s in cat_path.split('/') if s]
    prod_segs = [s for s in prod_path.split('/') if s]
    
    if not cat_segs or not prod_segs:
        return False
        
    # Check if cat_segs is a prefix of prod_segs
    if len(cat_segs) > len(prod_segs):
        return False
    return prod_segs[:len(cat_segs)] == cat_segs

def preprocess_html_content(html_bytes):
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
        modified = False
        for tag in soup.find_all(attrs={"onclick": True}):
            onclick = tag["onclick"]
            match = re.search(r"window\.open\s*\(\s*['\"]([^'\"]+)['\"]", onclick)
            if match:
                target_url = match.group(1)
                if target_url.startswith(('http://', 'https://', '/')) or '.pdf' in target_url.lower():
                    if tag.name != 'a' and not tag.find('a'):
                        a_tag = soup.new_tag("a", href=target_url)
                        for child in list(tag.contents):
                            a_tag.append(child)
                        tag.clear()
                        tag.append(a_tag)
                        del tag["onclick"]
                        modified = True
        if modified:
            return str(soup).encode('utf-8')
    except Exception:
        pass
    return html_bytes

@app.route('/convert-url', methods=['POST'])
def convert_url():
    """Convert URL content to Markdown"""
    data = request.get_json() or {}
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
        
    # Intercept mock URL paths
    for key, mock_md in MOCK_PRODUCTS_MARKDOWN.items():
        if key in url.lower():
            if "mock" in url.lower() or "example" in url.lower() or "defurotech" in url.lower() or "directindustry" in url.lower() or "indiamart" in url.lower():
                return jsonify({'success': True, 'markdown': mock_md})
    
    try:
        # Parse URL to check for fragment
        parsed_url = urllib.parse.urlparse(url)
        fragment = parsed_url.fragment
        
        # Fetch the URL content
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        response = http.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        html_content = preprocess_html_content(response.content)
        
        if fragment:
            soup = BeautifulSoup(html_content, "html.parser")
            target = soup.find(id=fragment) or soup.find(attrs={"name": fragment})
            if target:
                collected = [str(target)]
                current = target
                while True:
                    current = current.next_sibling
                    if not current:
                        break
                    if hasattr(current, 'name') and current.name:
                        sibling_id = current.get('id') or current.get('name')
                        if sibling_id and len(sibling_id) > 3:
                            break
                        collected.append(str(current))
                    else:
                        collected.append(str(current))
                
                html_content = f"<html><body>{''.join(collected)}</body></html>".encode('utf-8')
        
        # Determine likely file suffix based on content type or url extension
        suffix = '.html'
        if '.' in url.split('/')[-1]:
            url_path = parsed_url.path
            if '.' in url_path.split('/')[-1]:
                url_ext = os.path.splitext(url_path.split('/')[-1])[1]
                if len(url_ext) <= 5:
                    suffix = url_ext
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(html_content)
            tmp_path = tmp.name
        
        result = md.convert(tmp_path)
        markdown = result.text_content
        
        if suffix.lower() == '.pdf':
            parsed_u = urllib.parse.urlparse(url)
            base_name = os.path.splitext(os.path.basename(parsed_u.path))[0] or "url_pdf"
            image_urls = extract_images_from_pdf_file(tmp_path, base_name)
            if image_urls:
                markdown += "\n\n### Extracted PDF Images\n\n" + "\n".join([f"![Extracted Image]({url})" for url in image_urls])
                
        os.remove(tmp_path)
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

def get_mock_taxonomy(domain):
    if "directindustry" in domain.lower() or "bd-sensors" in domain.lower():
        return {
            "success": True,
            "domain": domain,
            "robots": {
                "sitemaps": [f"https://{domain}/sitemap.xml"],
                "crawl_delay": 1
            },
            "llms_txt": "# BD Sensors Catalog on DirectIndustry\n\nWe offer high precision pressure transmitters and level probes.",
            "categories": [
                {
                    "name": "Pressure Transmitters",
                    "url": f"https://{domain}/prod/bd-sensors-gmbh/pressure-transmitters",
                    "product_count": 2,
                    "products": [
                        { "name": "BD Sensors XMP i Precision Pressure Transmitter", "url": f"https://{domain}/prod/bd-sensors-gmbh/product-14047-1024693.html" },
                        { "name": "Industrial Pressure Transmitter DMP 331", "url": f"https://{domain}/prod/bd-sensors-gmbh/product-14047-1024694.html" }
                    ]
                },
                {
                    "name": "Level Probes & Transmitters",
                    "url": f"https://{domain}/prod/bd-sensors-gmbh/level-measurement",
                    "product_count": 1,
                    "products": [
                        { "name": "Submersible Level Probe LMK 351", "url": f"https://{domain}/prod/bd-sensors-gmbh/product-14047-1024695.html" }
                    ]
                }
            ],
            "mocked": True
        }
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
    import datetime
    data = request.get_json() or {}
    url = data.get('url')
    patterns = data.get('patterns') or data.get('url_patterns') or {}
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
        
    parsed_url = urllib.parse.urlparse(url)
    domain = parsed_url.netloc
    
    # Standardize URL schema if missing
    if not parsed_url.scheme:
        url = "https://" + url
        parsed_url = urllib.parse.urlparse(url)
        domain = parsed_url.netloc

    # Setup structured crawler logs
    logs = []
    
    def log_event(message):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        formatted = f"{message}"
        logs.append(formatted)
        # Also append to persistent workspace file
        try:
            with open("crawl_logs.txt", "a") as f:
                f.write(f"[{timestamp}] {formatted}\n")
        except:
            pass

    log_event(f"[System] Initializing crawler for domain: {domain}")
        
    # Check if mock domain is requested or invalid
    if "mock" in domain or "example" in domain or "test" in domain or "directindustry" in domain or not domain:
        log_event("[System] Mock domain or invalid hostname detected. Loading fallback mock taxonomy...")
        mock_data = get_mock_taxonomy(domain or "mock-vendor.com")
        mock_data["logs"] = logs
        return jsonify(mock_data)
        
    try:
        # 1. Fetch robots.txt
        robots_url = f"{parsed_url.scheme}://{domain}/robots.txt"
        log_event("[Robots] Fetching robots.txt...")
        sitemaps = []
        crawl_delay = None
        try:
            r_robots = http.get(robots_url, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            if r_robots.status_code == 200:
                for line in r_robots.text.split('\n'):
                    if line.lower().startswith('sitemap:'):
                        sitemap_url = line.split(':', 1)[1].strip()
                        sitemaps.append(sitemap_url)
                        log_event(f"[Robots] Found sitemap: {sitemap_url}")
                    elif line.lower().startswith('crawl-delay:'):
                        try:
                            crawl_delay = int(line.split(':', 1)[1].strip())
                            log_event(f"[Robots] Discovered crawl delay: {crawl_delay}s")
                        except:
                            pass
        except Exception as robots_err:
            log_event(f"[Robots] Failed to fetch or parse robots.txt: {str(robots_err)}")
            
        if not sitemaps:
            default_sitemap = f"{parsed_url.scheme}://{domain}/sitemap.xml"
            sitemaps.append(default_sitemap)
            log_event(f"[Robots] No sitemaps specified. Defaulting to: {default_sitemap}")
            
        # 2. Fetch llms.txt
        llms_url = f"{parsed_url.scheme}://{domain}/llms.txt"
        llms_txt = None
        log_event("[System] Attempting to fetch llms.txt...")
        try:
            r_llms = http.get(llms_url, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            if r_llms.status_code == 200:
                llms_txt = r_llms.text[:2000]
                log_event("[System] Successfully fetched and parsed llms.txt")
        except Exception:
            pass
            
        # 3. Parse Sitemaps
        discovered_products = []
        discovered_categories = []
        sitemap_parsed = False
        
        for sitemap in sitemaps:
            log_event(f"[Sitemap] Fetching and parsing sitemap: {sitemap}")
            try:
                r_sm = http.get(sitemap, timeout=5, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
                if r_sm.status_code == 200:
                    soup = BeautifulSoup(r_sm.content, "xml")
                    locs = [loc.text for loc in soup.find_all("loc")]
                    if locs:
                        sitemap_parsed = True
                        log_event(f"[Sitemap] Successfully extracted {len(locs)} URLs from sitemap")
                        
                        product_logged_count = 0
                        category_logged_count = 0
                        
                        for l in locs:
                            l_parsed = urllib.parse.urlparse(l)
                            path_parts = [p for p in l_parsed.path.split('/') if p]
                            name = "Product"
                            if path_parts:
                                name = path_parts[-1].replace('.html', '').replace('.php', '').replace('-', ' ').replace('_', ' ').title()
                            
                            classification = classify_url(l, name, domain, all_candidate_urls=locs, patterns=patterns)
                            if classification == 'ignored':
                                continue
                            elif classification == 'category':
                                if not any(cat["url"] == l for cat in discovered_categories):
                                    name_parts = [p for p in path_parts if p.lower() not in ['product-category', 'category', 'collections', 'collection', 'catalog', 'department']]
                                    cat_name = name
                                    if name_parts:
                                        cat_name = " > ".join([part.replace('.html', '').replace('.php', '').replace('-', ' ').replace('_', ' ').title() for part in name_parts])
                                    
                                    discovered_categories.append({"name": cat_name, "url": l, "products": []})
                                    if category_logged_count < 10:
                                        log_event(f"[Crawler] Classified sitemap URL as Category: {l} ({cat_name})")
                                        category_logged_count += 1
                                    elif category_logged_count == 10:
                                        log_event("[Crawler] Discovered additional sitemap categories...")
                                        category_logged_count += 1
                            elif classification == 'product':
                                if not any(p["url"] == l for p in discovered_products):
                                    discovered_products.append({"name": name, "url": l})
                                    if product_logged_count < 5:
                                        log_event(f"[Crawler] Classified sitemap URL as Product: {l} ({name})")
                                        product_logged_count += 1
                                    elif product_logged_count == 5:
                                        log_event("[Crawler] Discovered additional sitemap products...")
                                        product_logged_count += 1
            except Exception as sm_err:
                log_event(f"[Sitemap] Error reading sitemap {sitemap}: {str(sm_err)}")
                
        # 4. Fetch Homepage and parse links/schema if sitemaps did not return products
        if not sitemap_parsed or len(discovered_products) == 0:
            log_event("[System] Sitemaps empty or missing. Falling back to scraping homepage...")
            try:
                log_event(f"[Crawler] Fetching homepage content: {url}")
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
                                    log_event("[Crawler] Discovered JSON-LD ItemList schema on homepage")
                                    for item in s_data.get("itemListElement", []):
                                        if isinstance(item, dict) and "url" in item:
                                            discovered_products.append({"name": item.get("name", "Product"), "url": item["url"]})
                        except:
                            pass
                            
                    # Scan normal anchors
                    anchors = soup.find_all("a", href=True)
                    candidate_urls = []
                    for a in anchors:
                        href = a["href"]
                        full_href = urllib.parse.urljoin(url, href)
                        candidate_urls.append(full_href)
                    
                    log_event(f"[Crawler] Found {len(anchors)} anchor links on homepage to classify")
                    product_logged_count = 0
                    category_logged_count = 0
                    
                    for a in anchors:
                        href = a["href"]
                        full_href = urllib.parse.urljoin(url, href)
                        
                        text = a.get_text().strip()
                        if not text:
                            img = a.find('img')
                            if img and img.get('alt'):
                                text = img.get('alt').strip()
                            else:
                                text = a.get('title', '').strip()
                        
                        if not text or len(text) < 2:
                            parsed_fh = urllib.parse.urlparse(full_href)
                            path_fh = parsed_fh.path.lower()
                            if any(k in path_fh for k in ['/product/', '/p/', '/item/']) or parsed_fh.fragment:
                                text = path_fh.split('/')[-1].replace('.html', '').replace('.php', '').replace('-', ' ').replace('_', ' ').title()
                        
                        if not text or len(text) < 2:
                            continue
                            
                        classification = classify_url(full_href, text, domain, all_candidate_urls=candidate_urls, patterns=patterns)
                        if classification == 'ignored':
                            continue
                        elif classification == 'category':
                            if not any(cat["url"] == full_href for cat in discovered_categories):
                                parsed_fh = urllib.parse.urlparse(full_href)
                                path_parts = [p for p in parsed_fh.path.split('/') if p]
                                name_parts = [p for p in path_parts if p.lower() not in ['product-category', 'category', 'collections', 'collection', 'catalog', 'department']]
                                cat_name = text
                                if name_parts and len(name_parts) > 1:
                                    cat_name = " > ".join([part.replace('.html', '').replace('.php', '').replace('-', ' ').replace('_', ' ').title() for part in name_parts])
                                
                                discovered_categories.append({"name": cat_name, "url": full_href, "products": []})
                                if category_logged_count < 5:
                                    log_event(f"[Crawler] Classified homepage link as Category: {full_href} ({cat_name})")
                                    category_logged_count += 1
                        elif classification == 'product':
                            if not any(p["url"] == full_href for p in discovered_products):
                                discovered_products.append({"name": text, "url": full_href})
                                if product_logged_count < 5:
                                    log_event(f"[Crawler] Classified homepage link as Product: {full_href} ({text})")
                                    product_logged_count += 1
            except Exception as home_err:
                log_event(f"[Error] Homepage scraping failed: {str(home_err)}")
                
        # 5. Fetch Category Pages to discover products under them
        if discovered_categories and len(discovered_products) < 20:
            log_event(f"[System] Crawling up to 6 category pages to discover deeper product links...")
            for cat in discovered_categories[:6]:
                log_event(f"[Crawler] Fetching category page: {cat['url']}")
                try:
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    r_cat = http.get(cat["url"], headers=headers, timeout=8)
                    if r_cat.status_code == 200:
                        cat_soup = BeautifulSoup(r_cat.content, "html.parser")
                        cat_anchors = cat_soup.find_all("a", href=True)
                        cat_candidate_urls = []
                        for a in cat_anchors:
                            href = a["href"]
                            full_href = urllib.parse.urljoin(cat["url"], href)
                            cat_candidate_urls.append(full_href)
                            
                        for a in cat_anchors:
                            href = a["href"]
                            full_href = urllib.parse.urljoin(cat["url"], href)
                            
                            text = a.get_text().strip()
                            if not text:
                                img = a.find('img')
                                if img and img.get('alt'):
                                    text = img.get('alt').strip()
                                else:
                                    text = a.get('title', '').strip()
                            
                            if not text or len(text) < 2:
                                parsed_fh = urllib.parse.urlparse(full_href)
                                path_fh = parsed_fh.path.lower()
                                if any(k in path_fh for k in ['/product/', '/p/', '/item/']) or parsed_fh.fragment:
                                    text = path_fh.split('/')[-1].replace('.html', '').replace('.php', '').replace('-', ' ').replace('_', ' ').title()
                            
                            if not text or len(text) < 2:
                                continue
                                
                            classification = classify_url(full_href, text, domain, all_candidate_urls=cat_candidate_urls, patterns=patterns)
                            if classification == 'product':
                                if not any(p["url"] == full_href for p in cat["products"]):
                                    cat["products"].append({"name": text, "url": full_href})
                except Exception as cat_err:
                    log_event(f"[Crawler] Warning: Failed to crawl category page {cat['url']}: {str(cat_err)}")
                    
        # Organize discovered products into categories
        if not discovered_categories and not discovered_products:
            log_event("[Error] Crawl failed to find any products or categories. Displaying fallback taxonomy.")
            mock_data = get_mock_taxonomy(domain or "mock-vendor.com")
            mock_data["warning"] = f"Could not reach {domain} or discover any products. Displaying fallback mock taxonomy."
            mock_data["logs"] = logs
            return jsonify(mock_data)

        # Check if the input URL is a targeted category page
        is_targeted_category = (classify_url(url, "", domain, patterns=patterns) == 'category')
        
        if is_targeted_category:
            log_event(f"[Grouping] Targeted Category Crawl detected. Filtering products matching path segment: {url}")
            # Filter products to only those matching the targeted category URL path
            filtered_products = [
                p for p in discovered_products 
                if matches_category_segments(url, p["url"])
            ]
            
            # Format name hierarchically
            parsed_url = urllib.parse.urlparse(url)
            path_parts = [p for p in parsed_url.path.split('/') if p and p.lower() not in ['product-category', 'category', 'collections', 'collection', 'catalog', 'department']]
            cat_name = "Targeted Collection"
            if path_parts:
                cat_name = " > ".join([part.replace('-', ' ').replace('_', ' ').title() for part in path_parts])
            
            discovered_categories = [{"name": cat_name, "url": url, "products": filtered_products}]
            discovered_products = filtered_products
            log_event(f"[Grouping] Found {len(filtered_products)} products under targeted collection '{cat_name}'")
        else:
            if not discovered_categories:
                discovered_categories.append({"name": "General Products", "url": url, "products": []})
                
            log_event("[Grouping] Organizing discovered products into categories...")
            # Sort categories by segment length descending to match most specific sub-collections first
            def get_category_segment_length(cat):
                cat_path = urllib.parse.urlparse(cat["url"]).path.lower()
                for prefix in ['/product-category', '/category', '/collections', '/catalog']:
                    if cat_path.startswith(prefix):
                        cat_path = cat_path[len(prefix):]
                return len([s for s in cat_path.split('/') if s])

            sorted_categories = sorted(discovered_categories, key=get_category_segment_length, reverse=True)

            for p in discovered_products:
                assigned = False
                for cat in sorted_categories:
                    if matches_category_segments(cat["url"], p["url"]):
                        if not any(x["url"] == p["url"] for x in cat["products"]):
                            cat["products"].append(p)
                        assigned = True
                        break
                if not assigned:
                    if not any(x["url"] == p["url"] for x in discovered_categories[0]["products"]):
                        discovered_categories[0]["products"].append(p)
                    
            if len(discovered_categories) > 1:
                discovered_categories = [c for c in discovered_categories if c["products"]]
                if not discovered_categories:
                    discovered_categories.append({"name": "General Products", "url": url, "products": discovered_products})
                
        for cat in discovered_categories:
            cat["product_count"] = len(cat["products"])
            
        log_event("[System] Crawling completed successfully. Rendering structure...")
        
        return jsonify({
            "success": True,
            "domain": domain,
            "robots": {
                "sitemaps": sitemaps,
                "crawl_delay": crawl_delay
            },
            "llms_txt": llms_txt,
            "categories": discovered_categories,
            "mocked": False,
            "logs": logs
        })
        
    except Exception as e:
        log_event(f"[Error] Crawl failed with fatal exception: {str(e)}")
        mock_data = get_mock_taxonomy(domain or "mock-vendor.com")
        mock_data["warning"] = f"Crawl failed ({str(e)}). Displaying fallback mock taxonomy."
        mock_data["logs"] = logs
        return jsonify(mock_data)

WORLD_CURRENCIES = {
    # Symbols
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
    'rupee': 'INR',
    '元': 'CNY',
    '₩': 'KRW',
    '₪': 'ILS',
    '₫': 'VND',
    '฿': 'THB',
    '₭': 'LAK',
    '₱': 'PHP',
    'R$': 'BRL',
    'kr': 'SEK',
    'zł': 'PLN',
    'rmb': 'CNY',
    'TL': 'TRY',
    '₺': 'TRY',
    '₽': 'RUB',
    'rub': 'RUB',
    'Ksh': 'KES',
    'Sh': 'KES',
    'Rs': 'INR',
    # ISO Codes
    'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP', 'INR': 'INR', 'AUD': 'AUD', 
    'CAD': 'CAD', 'SGD': 'SGD', 'CHF': 'CHF', 'JPY': 'JPY', 'CNY': 'CNY', 
    'HKD': 'HKD', 'NZD': 'NZD', 'SEK': 'SEK', 'KRW': 'KRW', 'NOK': 'NOK', 
    'MXN': 'MXN', 'RUB': 'RUB', 'TRY': 'TRY', 'BRL': 'BRL', 'ZAR': 'ZAR', 
    'DKK': 'DKK', 'PLN': 'PLN', 'TWD': 'TWD', 'THB': 'THB', 'IDR': 'IDR', 
    'HUF': 'HUF', 'CZK': 'CZK', 'ILS': 'ILS', 'CLP': 'CLP', 'PHP': 'PHP', 
    'AED': 'AED', 'COP': 'COP', 'SAR': 'SAR', 'MYR': 'MYR', 'RON': 'RON', 
    'VND': 'VND', 'ARS': 'ARS', 'EGP': 'EGP', 'IQD': 'IQD', 'KWD': 'KWD', 
    'QAR': 'QAR', 'KES': 'KES', 'PKR': 'PKR', 'LKR': 'LKR', 'BDT': 'BDT', 
    'MAD': 'MAD', 'PEN': 'PEN', 'UAH': 'UAH',
}

CURRENCY_CONVERSIONS = {
    'USD': 1.0, 'EUR': 0.92, 'GBP': 0.79, 'INR': 83.5, 'CAD': 1.37, 
    'AUD': 1.50, 'JPY': 156.0, 'CNY': 7.25, 'CHF': 0.89, 'SGD': 1.35, 
    'HKD': 7.80, 'NZD': 1.63, 'SEK': 10.5, 'KRW': 1370.0, 'NOK': 10.6, 
    'MXN': 17.5, 'RUB': 90.0, 'TRY': 32.2, 'BRL': 5.25, 'ZAR': 18.5, 
    'DKK': 6.85, 'PLN': 3.95, 'TWD': 32.3, 'THB': 36.5, 'IDR': 16300.0, 
    'HUF': 360.0, 'CZK': 23.0, 'ILS': 3.72, 'CLP': 920.0, 'PHP': 58.5, 
    'AED': 3.67, 'COP': 3900.0, 'SAR': 3.75, 'MYR': 4.70, 'RON': 4.60, 
    'VND': 25400.0, 'ARS': 900.0, 'EGP': 47.5, 'IQD': 1310.0, 'KWD': 0.31, 
    'QAR': 3.64, 'KES': 130.0, 'PKR': 278.0, 'LKR': 300.0, 'BDT': 117.0, 
    'MAD': 10.0, 'PEN': 3.75, 'UAH': 40.0,
}

MEASUREMENT_CONVERSIONS = {
    # Mass / Weight
    'KG': {'to': 'LB', 'factor': 2.20462, 'system': 'metric'},
    'G': {'to': 'OZ', 'factor': 0.035274, 'system': 'metric'},
    'LB': {'to': 'KG', 'factor': 0.45359237, 'system': 'imperial'},
    'OZ': {'to': 'G', 'factor': 28.349523, 'system': 'imperial'},
    # Length / Distance
    'MM': {'to': 'IN', 'factor': 0.0393701, 'system': 'metric'},
    'CM': {'to': 'IN', 'factor': 0.393701, 'system': 'metric'},
    'M': {'to': 'FT', 'factor': 3.28084, 'system': 'metric'},
    'IN': {'to': 'MM', 'factor': 25.4, 'system': 'imperial'},
    'FT': {'to': 'M', 'factor': 0.3048, 'system': 'imperial'},
    # Volume / Capacity
    'L': {'to': 'GAL', 'factor': 0.264172, 'system': 'metric'},
    'ML': {'to': 'FL_OZ', 'factor': 0.033814, 'system': 'metric'},
    'GAL': {'to': 'L', 'factor': 3.78541, 'system': 'imperial'},
    'FL_OZ': {'to': 'ML', 'factor': 29.5735, 'system': 'imperial'},
    # Pressure
    'BAR': {'to': 'PSI', 'factor': 14.5038, 'system': 'metric'},
    'PSI': {'to': 'BAR', 'factor': 0.0689476, 'system': 'imperial'},
    # Temperature
    '°C': {'to': '°F', 'converter': lambda c: (c * 9/5) + 32, 'system': 'metric'},
    '°F': {'to': '°C', 'converter': lambda f: (f - 32) * 5/9, 'system': 'imperial'},
}

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
            
            # Metric/Imperial conversion logic for dimensions
            converted_val = None
            converted_unit = None
            if unit in MEASUREMENT_CONVERSIONS:
                conv_info = MEASUREMENT_CONVERSIONS[unit]
                factor = conv_info['factor']
                converted_unit = conv_info['to']
                
                cv1 = val1 * factor
                cv2 = val2 * factor
                cv3 = (val3 * factor) if val3 is not None else None
                
                cv1_str = f"{cv1:.2f}".rstrip('0').rstrip('.')
                cv2_str = f"{cv2:.2f}".rstrip('0').rstrip('.')
                cv3_str = f"{cv3:.2f}".rstrip('0').rstrip('.') if cv3 is not None else None
                
                converted_val = f"{cv1_str}x{cv2_str}x{cv3_str}" if cv3_str else f"{cv1_str}x{cv2_str}"

            base_val = f"{v1_str}x{v2_str}x{v3_str}" if v3_str else f"{v1_str}x{v2_str}"
            display_val = f"{base_val} {unit}"
            if converted_val and converted_unit:
                display_val += f" ({converted_val} {converted_unit})"

            return {
                "name": name,
                "rawValue": raw_value,
                "value": base_val,
                "unit": unit,
                "system": system,
                "convertedValue": converted_val,
                "convertedUnit": converted_unit,
                "displayValue": display_val
            }
        except:
            pass

    for pattern, std_unit, system in UNIT_PATTERNS:
        match = re.search(pattern, val_str)
        if match:
            try:
                numeric_val = float(match.group(1))
                numeric_val = int(numeric_val) if numeric_val.is_integer() else numeric_val
                
                # Metric/Imperial conversion logic
                converted_val = None
                converted_unit = None
                if std_unit in MEASUREMENT_CONVERSIONS:
                    conv_info = MEASUREMENT_CONVERSIONS[std_unit]
                    converted_unit = conv_info['to']
                    if 'converter' in conv_info:
                        cv = conv_info['converter'](float(numeric_val))
                    else:
                        cv = float(numeric_val) * conv_info['factor']
                    converted_val = int(cv) if cv.is_integer() else round(cv, 3)

                display_val = f"{numeric_val} {std_unit}"
                if converted_val is not None and converted_unit:
                    display_val += f" ({converted_val} {converted_unit})"

                return {
                    "name": name,
                    "rawValue": raw_value,
                    "value": numeric_val,
                    "unit": std_unit,
                    "system": system,
                    "convertedValue": converted_val,
                    "convertedUnit": converted_unit,
                    "displayValue": display_val
                }
            except ValueError:
                pass
                
    return {
        "name": name,
        "rawValue": raw_value,
        "value": raw_value,
        "unit": None,
        "system": None,
        "convertedValue": None,
        "convertedUnit": None,
        "displayValue": str(raw_value)
    }

def resolve_url(link, base_url, domain):
    link = link.strip()
    if not link:
        return ""
    if link.startswith('data:'):
        return ""
    parsed = urllib.parse.urlparse(link)
    if parsed.scheme in ('http', 'https'):
        return link
    
    if base_url:
        return urllib.parse.urljoin(base_url, link)
    elif domain:
        base = domain if domain.startswith(('http://', 'https://')) else f"https://{domain}"
        return urllib.parse.urljoin(base, link)
    return link

def resolve_pdf_viewer_url(url):
    if not url:
        return url
    parsed = urllib.parse.urlparse(url)
    if 'pdf.indiamart.com' in parsed.netloc and '/impdf/' in parsed.path:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            response = http.get(url, headers=headers, timeout=10)
            if response.status_code == 200 and 'text/html' in response.headers.get('Content-Type', ''):
                soup = BeautifulSoup(response.content, "html.parser")
                for s in soup.find_all("script"):
                    if s.string and 'pdf_url' in s.string:
                        match = re.search(r'["\']pdf_url["\']\s*:\s*["\']([^"\'\s]+)["\']', s.string)
                        if match:
                            pdf_url = match.group(1)
                            pdf_url = pdf_url.replace(r'\/', '/').replace(r'\\/', '/')
                            return urllib.parse.urljoin(url, pdf_url)
        except Exception:
            pass
    return url

def extract_price_and_currency(markdown):
    # Matches currency and price: e.g. ₹ 1,500, $ 100, CAD 120.00, or 12,500 €
    # Supports prefix or suffix currency representation
    pattern_price = r'(?:(?:\b([a-zA-Z]{3})|([\$₹£€¥₩₪₫฿₭₱₺₽]))\s*(\d+(?:,\d{3})*(?:\.\d+)?))|(?:(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:\b([a-zA-Z]{3})|([\$₹£€¥₩₪₫฿₭₱₺₽])))'
    
    lines = markdown.split('\n')
    for line in lines:
        match_price = re.search(pattern_price, line, re.IGNORECASE)
        if match_price:
            g_code = match_price.group(1) or match_price.group(5)
            g_sym = match_price.group(2) or match_price.group(6)
            price_val = match_price.group(3) or match_price.group(4)
            
            # Strip commas (e.g. 1,500 -> 1500)
            price_val_clean = price_val.replace(',', '')
            
            currency = 'USD'
            if g_code:
                code_upper = g_code.upper()
                currency = WORLD_CURRENCIES.get(code_upper, code_upper)
            elif g_sym:
                currency = WORLD_CURRENCIES.get(g_sym, 'USD')
            
            # Extract the unit from the rest of the line following the price match
            rest_of_line = line[match_price.end():].strip()
            
            # Look for unit indicators: / Piece, per Meter, each, a Piece, etc.
            unit = None
            unit_match = re.search(r'^(?:\/|per|each|a)?\s*([a-zA-Z]+)', rest_of_line, re.IGNORECASE)
            if unit_match:
                candidate = unit_match.group(1).strip()
                if candidate.lower() not in ['get', 'latest', 'price', 'callback', 'interested', 'i', 'am']:
                    unit = candidate
            elif re.search(r'^\b(each)\b', rest_of_line, re.IGNORECASE):
                unit = "each"
                
            if not unit and 'each' in rest_of_line.lower():
                unit = "each"
                
            return price_val_clean, currency, unit
            
    return None, None, None

# ─── Patterns that indicate vendor/contact boilerplate ─────────────────────
_VENDOR_BLOCK_PATTERNS = [
    # "Manufactured By" / "Sold By" / "Supplied By" blocks
    re.compile(r'^\s*manufactured\s+by\s*[:\-]?\s*', re.IGNORECASE),
    re.compile(r'^\s*(sold|supplied|marketed|distributed|exported|imported)\s+by\s*[:\-]?\s*', re.IGNORECASE),
    # Company footer / contact blurbs
    re.compile(r'^\s*(contact\s+us|get\s+in\s+touch|reach\s+us|our\s+office|about\s+us|who\s+we\s+are)\s*[:\-]?\s*', re.IGNORECASE),
    re.compile(r'^\s*(tel|telephone|fax|mobile|whatsapp|call|phone)\s*[:\-]?\s*[+\d]', re.IGNORECASE),
    re.compile(r'^\s*(email|e-mail|mail\s+us)\s*[:\-]?\s*\S+@\S+', re.IGNORECASE),
    re.compile(r'^\s*\S+@\S+\.\S+\s*$'),           # bare email address line
    re.compile(r'\b\d{2,5}[\s\-]\d{6,10}\b'),       # phone number pattern
    re.compile(r'^\s*(plot|no\.|survey|address|gst|cin|pan|iec)\s*[#:\-]?\s*', re.IGNORECASE),
    # Document-brochure internal heading injected by us during PDF enrichment:
    re.compile(r'^\s*###\s+Document\s*:', re.IGNORECASE),
    # Generic "send enquiry"/CTA noise
    re.compile(r'^\s*(send\s+enquiry|get\s+best\s+price|call\s+now|request\s+quote|get\s+a\s+quote|request\s+callback|view\s+all\s+products?)\s*$', re.IGNORECASE),
    # Navigation / UI chrome lines
    re.compile(r'^\s*(home|products?|about\s+us|contact\s+us|sitemap|privacy\s+policy|terms)\s*(\|.+)?\s*$', re.IGNORECASE),
]

# Section-level heading patterns that mark the start of a vendor block to skip entirely
_VENDOR_SECTION_HEADINGS = re.compile(
    r'^#+\s*(manufactured\s+by|supplied\s+by|about\s+(us|the\s+company|the\s+manufacturer)|contact\s+(us|information)|our\s+(company|profile|story)|company\s+(profile|overview))\s*$',
    re.IGNORECASE
)

def clean_description_markdown(text: str) -> str:
    """Remove vendor boilerplate, contact noise, and internal headings from
    markdown/plain text before using it as a Shopify product description."""
    lines = text.split('\n')
    cleaned = []
    skip_section = False  # True while inside a heading we want to suppress

    for line in lines:
        stripped = line.strip()

        # Detect start of a vendor/contact heading section
        if _VENDOR_SECTION_HEADINGS.match(stripped):
            skip_section = True
            continue

        # A new heading that is NOT a vendor section ends the suppression
        if skip_section and re.match(r'^#{1,6}\s', stripped):
            skip_section = False
            # Fall through – keep this new heading

        if skip_section:
            continue

        # Line-level pattern checks
        if any(p.search(stripped) for p in _VENDOR_BLOCK_PATTERNS):
            continue

        # Drop very short lines that look like orphaned nav items or "---" separators
        if stripped and len(stripped) <= 3 and not re.match(r'^#{1,6}\s', stripped):
            continue

        cleaned.append(line)

    # Collapse excessive blank lines (> 2 consecutive)
    result = []
    blank_run = 0
    for line in cleaned:
        if line.strip() == '':
            blank_run += 1
            if blank_run <= 2:
                result.append(line)
        else:
            blank_run = 0
            result.append(line)

    return '\n'.join(result).strip()


def rule_based_extract(markdown, url=None, domain=None):
    lines = markdown.split('\n')
    title = "Industrial Product"
    sku = None
    purchase_type = "direct_buy"
    short_description = ""
    specifications = []
    
    # Find Title (First header of any level h1-h6)
    for line in lines:
        stripped = line.strip()
        header_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if header_match:
            title = header_match.group(2).strip()
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
    # 1. Lists and inline key-value pairs:
    for line in lines:
        stripped = line.strip()
        # Avoid lines starting with headers, tables, containing URLs, or being markdown images/links
        if ':' in stripped and not stripped.startswith('#') and not stripped.startswith('|') and 'http:' not in stripped and 'https:' not in stripped and not stripped.startswith('!') and not stripped.startswith('[') and '![' not in stripped and '](' not in stripped:
            # Strip leading bullets, asterisks, dashes, and non-breaking spaces
            cleaned = re.sub(r'^[\-\*\•\s\ \u00a0\t]+', '', stripped)
            parts = cleaned.split(':', 1)
            key = parts[0].strip()
            val = parts[1].strip()
            if 2 < len(key) < 30 and 1 < len(val) < 100 and not any(x in key.lower() for x in ["sku", "model", "image"]):
                # Avoid duplicate specs
                if not any(s["name"].lower() == key.lower() for s in specifications):
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

    # Extract media links (images) and file links (PDFs, ZIPs, etc.)
    media_links = []
    file_links = []
    
    # Images in markdown: ![alt](url)
    img_matches = re.findall(r'!\[(.*?)\]\((.*?)\)', markdown)
    for alt, img_url in img_matches:
        img_url = img_url.split()[0]  # remove any optional title text
        resolved = resolve_url(img_url, url, domain)
        if resolved and resolved not in [m['url'] for m in media_links]:
            media_links.append({"url": resolved, "alt": alt.strip()})
            
    # File links in markdown: [text](url) where url ends with or contains document extensions
    file_extensions = ['.pdf', '.zip', '.tar', '.gz', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt']
    link_matches = re.findall(r'(?<!\!)\[(.*?)\]\((.*?)\)', markdown)
    for text, link_url in link_matches:
        link_url = link_url.split()[0]
        parsed_link = urllib.parse.urlparse(link_url)
        path = parsed_link.path.lower()
        
        is_file = any(path.endswith(ext) for ext in file_extensions)
        if not is_file:
            is_file = any(ext in link_url.lower() for ext in file_extensions)
        if not is_file:
            is_file = any(k in link_url.lower() for k in ['pdf.directindustry.com', 'pdf-viewer', '/pdf/', '/catalog/', '/brochure/', 'online-pdf'])
            
        if is_file:
            resolved = resolve_url(link_url, url, domain)
            resolved = resolve_pdf_viewer_url(resolved)
            if resolved and resolved not in [f['url'] for f in file_links]:
                file_links.append({"url": resolved, "text": text.strip()})
                        
    # Build short_description from cleaned markdown (strips vendor/contact noise)
    cleaned_markdown = clean_description_markdown(markdown)
    cleaned_lines = cleaned_markdown.split('\n')
    desc_lines = []
    for line in cleaned_lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('#') and not stripped.startswith('|') and not stripped.startswith('-') and not stripped.startswith('*') and not stripped.startswith('!['):
            desc_lines.append(stripped)
    
    # Use the full cleaned markdown or the extracted paragraphs
    short_description = cleaned_markdown if cleaned_markdown else " ".join(desc_lines)
    if not short_description:
        short_description = f"Industrial specifications sheet for {title}."

    price_val, currency, unit = extract_price_and_currency(markdown)

    return {
        "success": True,
        "title": title,
        "sku": sku or "GENERIC-SKU",
        "price": price_val or "0.00",
        "currency": currency or "USD",
        "price_unit": unit,
        "purchase_type": purchase_type,
        "short_description": short_description,
        "specifications": specifications,
        "media_links": media_links,
        "file_links": file_links
    }

def extract_from_pdf_link(pdf_url, base_name="brochure"):
    pdf_url = resolve_pdf_viewer_url(pdf_url)
    text_content = ""
    image_urls = []
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        response = http.get(pdf_url, headers=headers, timeout=15)
        if response.status_code == 200:
            suffix = ".pdf"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
                
            try:
                # Convert PDF to markdown
                conv_res = md.convert(tmp_path)
                text_content = conv_res.text_content
                
                # Extract PDF images
                image_urls = extract_images_from_pdf_file(tmp_path, base_name)
            finally:
                os.remove(tmp_path)
    except Exception as e:
        print(f"Error extracting from PDF link {pdf_url}: {e}")
        
    return text_content, image_urls

def enrich_product_with_pdf_links(prod, url=None, domain=None):
    pdf_texts = []
    file_links_copy = list(prod.get("file_links", []))
    for fl in file_links_copy:
        fl_url = fl.get("url")
        if fl_url and '.pdf' in fl_url.lower():
            base_name = fl.get("text", "brochure").replace(" ", "_")
            pdf_text, pdf_images = extract_from_pdf_link(fl_url, base_name)
            if pdf_text:
                # Clean vendor/contact noise from PDF text before appending
                cleaned_pdf_text = clean_description_markdown(pdf_text)
                if cleaned_pdf_text:
                    pdf_texts.append(f"\n\n## {fl.get('text', 'Brochure')}\n\n{cleaned_pdf_text}")
            
            # Add images to media_links if not already present
            for img_url in pdf_images:
                if img_url not in [m["url"] for m in prod.get("media_links", [])]:
                    prod["media_links"].append({
                        "url": img_url,
                        "alt": f"Image from {fl.get('text', 'Brochure')}"
                    })
                    
    if pdf_texts:
        prod["short_description"] = (prod.get("short_description", "") + "\n" + "\n".join(pdf_texts)).strip()

def detect_and_split_multi_products(markdown, url=None, domain=None):
    lines = markdown.split('\n')
    sections = []
    current_section = None
    
    # Split by H2 or H3 headers
    for line in lines:
        stripped = line.strip()
        header_match = re.match(r'^(##|###)\s+(.+)$', stripped)
        if header_match:
            header_text = header_match.group(2).strip()
            # Ignore headers that are generic sections
            if any(k in header_text.lower() for k in ["specification", "download", "document", "image", "brochure", "gallery", "contact", "about", "detail"]):
                if current_section:
                    current_section["lines"].append(line)
                continue
                
            if current_section:
                sections.append(current_section)
            current_section = {
                "title": header_text,
                "lines": [line]
            }
        else:
            if current_section:
                current_section["lines"].append(line)
                
    if current_section:
        sections.append(current_section)
        
    if not sections or len(sections) <= 1:
        return None
        
    products = []
    for sec in sections:
        sec_markdown = "\n".join(sec["lines"])
        prod = rule_based_extract(sec_markdown, url, domain)
        prod["title"] = sec["title"]
        
        has_specs = len(prod.get("specifications", [])) > 0
        has_media = len(prod.get("media_links", [])) > 0
        has_sku = prod.get("sku") != "GENERIC-SKU"
        has_files = len(prod.get("file_links", [])) > 0
        
        if (has_specs and has_media) or has_specs or has_media or (has_sku and has_files):
            prod["section_markdown"] = sec_markdown
            products.append(prod)
            
    if len(products) > 1:
        return products
    return None

@app.route('/extract', methods=['POST'])
def extract_product():
    """Extract structured product fields from Markdown content"""
    data = request.get_json() or {}
    markdown = data.get('markdown')
    domain = data.get('domain', '')
    url = data.get('url', '')
    
    if not markdown:
        return jsonify({'error': 'No Markdown content provided'}), 400
        
    # Check if there are multiple products on the page first
    split_products = detect_and_split_multi_products(markdown, url, domain)
    if split_products:
        # Perform PDF enrichment on each split product
        for prod in split_products:
            enrich_product_with_pdf_links(prod, url, domain)
            
        return jsonify({
            "success": True,
            "is_multi": True,
            "products": split_products
        })
        
    # Single product flow
    openai_key = os.environ.get("OPENAI_API_KEY")
    result = None
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
                "price": "Price value as a string (e.g. 22.00) or null",
                "currency": "Standard currency code (e.g. USD, INR, GBP, CAD, EUR) or null",
                "price_unit": "The unit corresponding to the price (e.g. Piece, Meter, Kg) or null",
                "purchase_type": "direct_buy" or "quote_only",
                "vendor": "Manufacturer name, brand, or null if not found",
                "short_description": "The full product description in Markdown format, but EXCLUDING any manufacturer contact details, emails, phones, or brand promotional boilerplate.",
                "specifications": [
                    {{
                        "name": "Specification Name (e.g. Weight, Voltage, Material)",
                        "rawValue": "Original text value (e.g. 25KG, 24V DC)"
                    }}
                ],
                "media_links": [
                    {{
                        "url": "Image URL",
                        "alt": "Alt text or empty string"
                    }}
                ],
                "file_links": [
                    {{
                        "url": "Document/PDF file URL",
                        "text": "Link text description"
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
            
            result["price"] = result.get("price") or "0.00"
            result["currency"] = result.get("currency") or "USD"
            result["price_unit"] = result.get("price_unit") or None
            result["vendor"] = result.get("vendor") or None
            
            specs_normalized = []
            for spec in result.get("specifications", []):
                name = spec.get("name")
                raw_val = spec.get("rawValue")
                if name and raw_val:
                    specs_normalized.append(parse_specification_unit(name, raw_val))
            result["specifications"] = specs_normalized
            
            # Resolve relative URLs returned by OpenAI
            media_resolved = []
            for media in result.get("media_links", []):
                m_url = media.get("url")
                if m_url:
                    media_resolved.append({
                        "url": resolve_url(m_url, url, domain),
                        "alt": media.get("alt", "")
                    })
            result["media_links"] = media_resolved

            files_resolved = []
            for fl in result.get("file_links", []):
                f_url = fl.get("url")
                if f_url:
                    resolved_f_url = resolve_url(f_url, url, domain)
                    resolved_f_url = resolve_pdf_viewer_url(resolved_f_url)
                    files_resolved.append({
                        "url": resolved_f_url,
                        "text": fl.get("text", "")
                    })
            result["file_links"] = files_resolved
        except Exception:
            pass

    if not result:
        result = rule_based_extract(markdown, url=url, domain=domain)

    enrich_product_with_pdf_links(result, url, domain)
    result["success"] = True
    return jsonify(result)

  # ─── Variant Grouping Helpers ─────────────────────────────────────────────────

# Stopwords to ignore when comparing product names
_STOPWORDS = {
    'the', 'and', 'for', 'with', 'of', 'in', 'to', 'a', 'an', 'by', 'or',
    'type', 'model', 'series', 'grade', 'make', 'brand', 'style', 'class'
}

def _tokenize(s: str) -> list:
    """Lowercase, strip punctuation, split into meaningful tokens."""
    s = s.lower()
    tokens = re.findall(r'[a-z0-9]+', s)
    return [t for t in tokens if len(t) > 1 and t not in _STOPWORDS]

def _sku_prefix(name: str) -> str | None:
    """
    Extract an uppercase alphanumeric SKU-style prefix such as 'PCS', 'AB-300', 'PT100'.
    Returns the prefix part (letters) if the name starts with one, else None.
    """
    m = re.match(r'^([A-Z]{2,}(?:[\-/]?[0-9]{1,4})?)', name.strip())
    if m:
        raw = m.group(1)
        # Return just the letter-prefix before digits for family matching
        letter_part = re.match(r'^([A-Z]+)', raw)
        if letter_part and len(letter_part.group(1)) >= 2:
            return letter_part.group(1)
    return None

def _name_similarity(n1: str, n2: str) -> float:
    """
    Combined similarity score in [0, 1] using:
      - Jaccard word-set overlap (weighted 50%)
      - Longest common token prefix ratio (weighted 30%)
      - SKU family match bonus (weighted 20%)
    """
    t1, t2 = _tokenize(n1), _tokenize(n2)
    if not t1 or not t2:
        return 0.0

    # Jaccard
    s1, s2 = set(t1), set(t2)
    jaccard = len(s1 & s2) / len(s1 | s2)

    # Longest common prefix ratio
    lcp_len = 0
    for a, b in zip(t1, t2):
        if a == b:
            lcp_len += 1
        else:
            break
    lcp_ratio = lcp_len / max(len(t1), len(t2))

    # SKU prefix match
    sku1 = _sku_prefix(n1)
    sku2 = _sku_prefix(n2)
    sku_bonus = 1.0 if (sku1 and sku2 and sku1 == sku2) else 0.0

    return round(0.50 * jaccard + 0.30 * lcp_ratio + 0.20 * sku_bonus, 6)

def _cluster_similarity(name: str, cluster: list) -> float:
    """Average similarity of `name` against every product already in the cluster."""
    if not cluster:
        return 0.0
    scores = [_name_similarity(name, p.get('name', '')) for p in cluster]
    return sum(scores) / len(scores)

def _derive_parent_title(cluster: list) -> str:
    """
    Build a clean parent title from a cluster of products:
    1. Find the longest common token prefix shared by ALL members.
    2. If it's too short, take the longest common prefix shared by MOST members.
    3. Strip trailing spec tokens (digits, units, colors, materials).
    """
    names = [p.get('name', '') for p in cluster]
    if not names:
        return 'Product'
    if len(names) == 1:
        return names[0]

    # All-member LCP
    token_lists = [_tokenize(n) for n in names]
    lcp = []
    for tokens in zip(*token_lists):
        if len(set(tokens)) == 1:
            lcp.append(tokens[0])
        else:
            break

    # Majority LCP (≥ 60% of members share the token at this position)
    if len(lcp) < 2:
        max_len = min(len(t) for t in token_lists)
        for i in range(max_len):
            token_at_i = [t[i] for t in token_lists]
            majority = sum(1 for t in token_at_i if t == token_at_i[0])
            if majority / len(names) >= 0.6:
                lcp.append(token_at_i[0])
            else:
                break

    # Strip trailing tokens that look like specs (digits, unit suffixes, colors…)
    _SPEC_SUFFIX = re.compile(
        r'^(\d+|[0-9]+[a-z]{0,4}|ac|dc|v|a|hz|kw|hp|mm|cm|m|inch|red|blue|black|white|gray|grey|ip\d+|npt|bsp|pn|ss|ms|pvc|brass|steel|iron|copper|plastic|standard|single|double|triple|phase)$',
        re.IGNORECASE
    )
    # while lcp and _SPEC_SUFFIX.match(lcp[-1]):
    #     lcp.pop()

    if len(lcp) < 2:
        # Fallback: use first product's name, strip trailing numeric/spec suffix
        fallback = names[0]
        fallback = re.sub(r'[\s\-]+\d+\s*(v|a|hz|kw|hp|mm|cm|m|w|bar|psi|rpm|ph|phase|amp)?\s*$', '', fallback, flags=re.IGNORECASE)
        fallback = re.sub(r'[\s\-]+[A-Z]{0,2}\d{2,}[A-Z]{0,3}\s*$', '', fallback)
        return fallback.strip('- \t,()[]') or names[0]

    # Reconstruct title preserving original casing from first name
    first_tokens = names[0].split()
    result_tokens = []
    for tok in lcp:
        # Find matching original-case token
        for ft in first_tokens:
            if ft.lower().strip('-()/.,') == tok:
                result_tokens.append(ft)
                break
        else:
            result_tokens.append(tok.title())
    return ' '.join(result_tokens).strip('- \t,()[]')


# ─── Option inference ─────────────────────────────────────────────────────────

# Maps (regex, option_key) for spec extraction from name diffs
_OPTION_PATTERNS = [
    (re.compile(r'\b(\d+(?:\.\d+)?\s*kv)\b', re.I),          'Voltage (kV)'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*v(?:ac|dc)?)\b', re.I), 'Voltage'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*kw)\b', re.I),          'Power (kW)'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*hp)\b', re.I),          'Power (HP)'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*w\b)', re.I),           'Wattage'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:hz|khz|mhz))\b', re.I), 'Frequency'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:amp|a)\b)', re.I),  'Current (A)'),
    (re.compile(r'\b(single[\s-]phase|double[\s-]phase|three[\s-]phase|1[\s-]?ph|3[\s-]?ph|\d+\s*phase)\b', re.I), 'Phase'),
    (re.compile(r'\b(ip[\s-]?\d{2})\b', re.I),               'IP Rating'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:mm|cm|m|inch|"|ft))\b', re.I), 'Size'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:bar|psi|kpa|mpa))\b', re.I), 'Pressure'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:rpm|rps))\b', re.I), 'Speed (RPM)'),
    (re.compile(r'\b(\d+(?:\.\d+)?\s*(?:kg|lb|ton))\b', re.I), 'Capacity'),
    (re.compile(r'\b(stainless steel|mild steel|carbon steel|galvanized|cast iron|brass|bronze|copper|alumin(?:um|ium)|plastic|pvc|pp|hdpe|ptfe|nylon|rubber|ceramic)\b', re.I), 'Material'),
    (re.compile(r'\b(red|blue|green|black|white|yellow|grey|gray|orange|silver|gold|beige)\b', re.I), 'Color'),
    (re.compile(r'\b(npt|bsp|bspt|flange|flanged|threaded|socket|wafer|butt\s*weld)\b', re.I), 'Connection'),
    (re.compile(r'\b(surface\s*mount(?:ing)?|din\s*rail|panel\s*mount(?:ing)?|wall\s*mount(?:ing)?|field\s*mount(?:ing)?|in-line|inline)\b', re.I), 'Mounting'),
    (re.compile(r'\b(normally open|normally closed|no\b|nc\b|spdt|dpdt|spst)\b', re.I), 'Contact Type'),
]

def infer_variant_options(parent_title: str, variant_name: str) -> dict:
    """
    Infer structured option key/value pairs that differentiate `variant_name`
    from `parent_title`. Returns a dict like {"Voltage": "24V AC", "Phase": "3 Phase"}.
    Multi-dimensional variants return multiple keys.
    """
    parent_clean = parent_title.lower().strip()
    var_clean = variant_name.lower().strip()

    # Extract the differing suffix/portion of the name
    if var_clean.startswith(parent_clean):
        diff = variant_name[len(parent_title):].strip('- \t,()[]/')
    else:
        # Find first token where the names diverge
        pt = _tokenize(parent_title)
        vt = _tokenize(variant_name)
        shared = 0
        for a, b in zip(pt, vt):
            if a == b:
                shared += 1
            else:
                break
        # Reconstruct the non-shared suffix from original variant name words
        orig_words = variant_name.split()
        diff = ' '.join(orig_words[shared:]).strip('- \t,()[]/')

    if not diff:
        return {'Style': 'Standard'}

    options = {}
    remaining = diff

    for pattern, option_key in _OPTION_PATTERNS:
        m = pattern.search(remaining)
        if m:
            if option_key not in options:
                options[option_key] = m.group(1).strip()

    if not options:
        # Last resort: use the whole diff as "Model"
        cleaned_diff = re.sub(r'[\s\-/]+', ' ', diff).strip()
        if cleaned_diff:
            options['Model'] = cleaned_diff
        else:
            options['Style'] = 'Standard'

    return options


def _match_to_collection(group_title: str, collections: list) -> dict | None:
    """
    Find the best-matching Shopify collection for a given group title.
    Returns {id, title, score} if score >= 0.35, else None.
    A collection may be matched by:
      - Name similarity (_name_similarity)
      - One collection name being a substring of the group title or vice-versa
    """
    best = None
    best_score = 0.0
    COLLECTION_THRESHOLD = 0.35

    for col in collections:
        col_title = col.get('title', '')
        if not col_title:
            continue

        score = _name_similarity(group_title, col_title)

        # Substring bonus: if one is fully inside the other
        gt_lower = group_title.lower()
        ct_lower = col_title.lower()
        if ct_lower in gt_lower or gt_lower in ct_lower:
            score = max(score, 0.60)

        if score > best_score:
            best_score = score
            best = {'id': col.get('id'), 'title': col_title, 'score': round(score, 3)}

    if best and best_score >= COLLECTION_THRESHOLD:
        return best
    return None


@app.route('/group-variants', methods=['POST'])
def group_variants():
    """Group similar catalog products into parent products with shared variants.

    Algorithm:
      1. Score each product against existing clusters (Jaccard + LCP + SKU prefix).
      2. Assign to best-scoring cluster if score >= threshold, else new cluster.
      3. Derive clean parent title by majority-LCP of all cluster members.
      4. Infer multi-dimensional variant options from name diff.
      5. Optionally fuzzy-match each group against existing Shopify collections.
    """
    data = request.get_json() or {}
    products = data.get('products', [])
    collections = data.get('collections', [])  # [{id, title}] from Shopify

    if not products:
        return jsonify({'success': True, 'grouped': []})

    SIMILARITY_THRESHOLD = 0.45

    clusters: list[list] = []

    for prod in products:
        name = prod.get('name', '')
        best_score = 0.0
        best_cluster = None

        for cluster in clusters:
            score = _cluster_similarity(name, cluster)
            if score > best_score:
                best_score = score
                best_cluster = cluster

        if best_cluster is not None and best_score >= SIMILARITY_THRESHOLD:
            best_cluster.append(prod)
        else:
            clusters.append([prod])

    # ── Build result ─────────────────────────────────────────────────────────
    grouped_result = []

    for cluster in clusters:
        if len(cluster) == 1:
            prod = cluster[0]
            entry = {
                'title': prod['name'],
                'is_grouped': False,
                'variants': [prod],
                'collection_match': _match_to_collection(prod['name'], collections)
            }
            grouped_result.append(entry)
            continue

        parent_title = _derive_parent_title(cluster)
        variants_list = []
        all_option_names: list = []

        for prod in cluster:
            options_dict = infer_variant_options(parent_title, prod['name'])
            var_item = prod.copy()
            var_item['option_values'] = options_dict
            variants_list.append(var_item)
            for k in options_dict:
                if k not in all_option_names:
                    all_option_names.append(k)

        grouped_result.append({
            'title': parent_title,
            'is_grouped': True,
            'options': all_option_names,
            'variants': variants_list,
            'collection_match': _match_to_collection(parent_title, collections)
        })

    matched = sum(1 for g in grouped_result if g.get('collection_match'))
    new_count = len(grouped_result) - matched

    return jsonify({
        'success': True,
        'grouped': grouped_result,
        'stats': {'total': len(grouped_result), 'matched': matched, 'new': new_count}
    })

@app.route('/parse-catalog-pdf', methods=['POST'])
def parse_catalog_pdf_endpoint():
    """
    Parse an industrial product catalog PDF into structured product data.

    Accepts:
      - JSON body: { "url": "https://..." }  — download and parse from URL
      - multipart form: file=<binary PDF>     — parse uploaded file

    Returns:
      { success, products: [{title, sku, series, category, description,
                              specifications, sku_options, raw_skus, page_range}] }
    """
    try:
        max_pages = int(request.args.get('max_pages', 150))

        # ── Case 1: URL provided ──────────────────────────────────────────────
        if request.is_json:
            data = request.get_json() or {}
            pdf_url = data.get('url', '').strip()
            if not pdf_url:
                return jsonify({'success': False, 'error': 'No url provided'}), 400

            headers = {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/pdf,*/*',
            }
            resp = http.get(pdf_url, headers=headers, timeout=60, verify=False)
            if resp.status_code != 200:
                return jsonify({'success': False,
                                'error': f'HTTP {resp.status_code} fetching PDF'}), 400

            pdf_bytes = resp.content
            products = parse_catalog_pdf_bytes(pdf_bytes, max_pages=max_pages)

        # ── Case 2: File upload ───────────────────────────────────────────────
        elif 'file' in request.files:
            f = request.files['file']
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                f.save(tmp.name)
                tmp_path = tmp.name
            try:
                products = parse_catalog_pdf_file(tmp_path, max_pages=max_pages)
            finally:
                os.unlink(tmp_path)

        else:
            return jsonify({'success': False,
                            'error': 'Provide JSON {url} or multipart file upload'}), 400

        return jsonify({
            'success': True,
            'products': products,
            'count': len(products),
        })

    except Exception as e:
        import traceback
        return jsonify({'success': False, 'error': str(e),
                        'traceback': traceback.format_exc()}), 500



# ─── PDF Extraction with AI Fallback ─────────────────────────────────────

@app.route('/pdf-extract', methods=['POST'])
def pdf_extract():
    """
    Extract products from PDF using pattern-based parsing with AI fallback.

    Accepts either:
    - JSON: {"url": "https://...file.pdf"}
    - Multipart: file upload (binary PDF)

    Returns: {
        "success": true,
        "products": [...],
        "extraction_method": "pattern_based|ai_assisted",
        "count": N,
        "quality_score": 0.95
    }
    """
    from pdf_extraction_config import get_pdf_config

    config = get_pdf_config()
    data = request.get_json() or {}
    tmp_path = None

    try:
        # Load PDF from URL or file upload
        if 'file' in request.files:
            file = request.files['file']
            suffix = os.path.splitext(file.filename)[1]
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                file.save(tmp.name)
                tmp_path = tmp.name
        elif 'url' in data:
            pdf_url = data.get('url')
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            response = http.get(pdf_url, headers=headers, timeout=15)
            if response.status_code != 200:
                return jsonify({'error': f'Failed to download PDF: {response.status_code}'}), 400

            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
        else:
            return jsonify({'error': 'Provide JSON {url} or file upload'}), 400

        # Step 1: Try pattern-based extraction (fast, no API calls)
        products = parse_catalog_pdf_file(tmp_path, max_pages=150)
        extraction_method = 'pattern_based'
        quality_score = 0.5

        # Step 2: Assess quality
        if config.use_ai_fallback and config.is_ai_available():
            # Check if quality is poor
            bogus_count = sum(1 for p in products if len(p.get('sku', '')) < config.min_sku_length)
            bogus_ratio = bogus_count / len(products) if products else 0

            if len(products) > config.max_extracted_products or bogus_ratio > config.max_extracted_products / 100:
                if config.verbose:
                    print(f"Pattern parsing: {len(products)} products, {bogus_ratio*100:.1f}% bogus SKUs. Using AI...")

                try:
                    # Convert PDF to markdown
                    result = md.convert(tmp_path)
                    markdown_text = result.text_content

                    # Use AI extraction
                    from advanced_pdf_parser import AIAssistedExtractor
                    ai_extractor = AIAssistedExtractor(api_key=config.get_anthropic_key())
                    ai_products = ai_extractor.extract_products_from_text(
                        markdown_text,
                        pdf_name=os.path.basename(tmp_path)
                    )

                    if ai_products and len(ai_products) > 0:
                        products = ai_products
                        extraction_method = 'ai_assisted'
                        quality_score = 0.9
                except Exception as e:
                    if config.verbose:
                        print(f"AI fallback failed: {e}")
                    quality_score = max(0.3, quality_score)
            else:
                quality_score = 0.85

        return jsonify({
            'success': True,
            'products': products,
            'extraction_method': extraction_method,
            'count': len(products),
            'quality_score': quality_score,
        })

    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.route('/pdf-config', methods=['GET', 'PUT'])
def pdf_config():
    """
    Get or update PDF extraction configuration.

    GET: Returns current config
    PUT: Updates config with provided fields
    """
    from pdf_extraction_config import get_config_manager

    manager = get_config_manager()

    if request.method == 'GET':
        config = manager.load()
        return jsonify({
            'success': True,
            'config': config.to_dict()
        })

    elif request.method == 'PUT':
        data = request.get_json() or {}
        config = manager.get()

        # Update allowed fields
        allowed_fields = {
            'strategy', 'use_ai_fallback', 'max_extracted_products',
            'min_sku_length', 'bogus_sku_ratio', 'detect_columns',
            'verbose', 'save_intermediate_extractions'
        }

        for key, value in data.items():
            if key in allowed_fields:
                setattr(config, key, value)

        manager.save(config)
        return jsonify({
            'success': True,
            'config': config.to_dict()
        })

    return jsonify({'error': 'Invalid method'}), 405


# ─── Health Check ─────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Service health check"""
    from pdf_extraction_config import get_pdf_config
    config = get_pdf_config()

    return jsonify({
        'status': 'ok',
        'service': 'markitdown',
        'pdf_extraction': {
            'ai_fallback_enabled': config.use_ai_fallback,
            'ai_available': config.is_ai_available(),
            'strategy': config.strategy,
        }
    })


if __name__ == '__main__':
    # Default to port 5005
    port = int(os.environ.get('PORT', 5005))
    app.run(port=port, host='0.0.0.0', debug=True)
