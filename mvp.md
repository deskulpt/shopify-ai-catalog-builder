

## ⚡ **Accelerated MVP: From Partner Account → Hello World (30 minutes)**

### **Step 1: Create Dev Store in Partner Dashboard** (5 min)

```
1. Go to: https://partners.shopify.com/dashboard
2. Click "Stores" → "Add store" → "Create development store" [web:75]
3. Choose: "Developer preview" (recommended for new features)
4. Store name: "product-ingest-ai-dev"
5. Click "Create"
```

You now have a dev store linked to your partner account.

***

### **Step 2: Create App via CDN/CLI** (5 min)

```bash
# Navigate to your projects folder
cd ~/projects  # or your preferred location

# Initialize Shopify app with Node + React template
npm init @shopify/app@latest -- --template=node

# When prompted:
# - App name: "product-ingest-ai"
# - Select: "Build a React Router app" [web:60]
# - Associate with partner account: Select your account
# - Dev store: Select "product-ingest-ai-dev"

cd product-ingest-ai
npm install
```

**CLI will automatically:**
- Create app in Dev Dashboard
- Generate `shopify.app.toml` with your API keys
- Set up OAuth flow[1][2]

***

### **Step 3: Install Python + MarkItDown** (3 min)

```bash
# Create Python virtual environment
python3 -m venv venv

# Activate (Mac/Linux)
source venv/bin/activate

# Activate (Windows)
venv\Scripts\activate

# Install MarkItDown + dependencies
pip install 'markitdown[all]' flask openai requests
```

***

### **Step 4: Create Python Backend Service** (5 min)

**File: `services/markitdown.py`** (create in root):

```python
from flask import Flask, request, jsonify
from markitdown import MarkItDown
import os
import tempfile
import requests as http

app = Flask(__name__)
md = MarkItDown()

@app.route('/convert', methods=['POST'])
def convert_file():
    """Convert uploaded file to Markdown"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name
    
    try:
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/convert-url', methods=['POST'])
def convert_url():
    """Convert URL content to Markdown"""
    data = request.get_json()
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    
    try:
        response = http.get(url, timeout=30)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.html') as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'markitdown'})

if __name__ == '__main__':
    app.run(port=5000, debug=True)
```

***

### **Step 5: Update Hello World UI** (5 min)

**File: `app/routes/app._index.tsx`** (replace entire content):

```tsx
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Layout,
  Text,
  Button,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import type { Route } from "./+types/app._index";
import { shopify } from "../shopify.server";

export const loader: Route.Loader = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  return { STORE_NAME: session.storeName };
};

export default function App() {
  const { STORE_NAME } = useLoaderData<typeof loader>();

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack>
              <Text as="h1" variant="headingMd">
                🎉 Product Ingest AI - Hello World!
              </Text>
              
              <Text as="p">
                Welcome to your Shopify app! This app is installed on:
                <strong> {STORE_NAME}</strong>
              </Text>
              
              <Card>
                <BlockStack>
                  <Text as="h2" variant="headingSm">
                    📋 What This App Will Do:
                  </Text>
                  <ul>
                    <li>Ingest PDF, DOC, HTML files or URLs</li>
                    <li>Convert to Markdown using Microsoft MarkItDown</li>
                    <li>Extract product data with AI (name, SKU, UPC, images)</li>
                    <li>Parse specifications with unit normalization (25KG → value=25, unit=KG, system=metric)</li>
                    <li>Match products to existing collections</li>
                    <li>Create new collections for product series</li>
                    <li>Auto-create variants (sizes, colors, materials)</li>
                    <li>Calculate completeness score for product data</li>
                  </ul>
                </BlockStack>
              </Card>
              
              <InlineStack gap="300">
                <Button onClick={() => window.alert("Next: Build upload interface!")}>
                  Start Ingesting Products
                </Button>
                <Button variant="secondary" onClick={() => window.open("https://dev.shopify.com/dashboard", "_blank")}>
                  View Dev Dashboard
                </Button>
              </InlineStack>
              
              <Text as="p" variant="bodySm">
                <strong>Status:</strong> MVP Phase ✓ | <strong>Next:</strong> Upload Interface + Backend
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```



***

### **Step 6: Run Dev Server** (2 min)

```bash
# Start Shopify development server
npm run dev

# CLI will prompt:
# 1. Dev store: Select "product-ingest-ai-dev" (already associated)
# 2. App will open at: https://your-random-url.ngrok.io
# 3. App installs automatically on dev store
```

**What you'll see:**
- Hello World UI appears in Shopify admin → Apps → Product Ingest AI
- Store name displayed dynamically
- Buttons ready for next phase[3][1]

***

### **Step 7: Run Python Service (Separate Terminal)** (2 min)

```bash
# In NEW terminal window, navigate to project
cd ~/projects/product-ingest-ai

# Activate Python environment
source venv/bin/activate  # Windows: venv\Scripts\activate

# Start MarkItDown service
python services/markitdown.py

# Service runs on: http://localhost:5000
# Test: curl http://localhost:5000/health
```

***

## 📁 **Complete File Structure**

```bash
product-ingest-ai/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx       ← Updated Hello World UI
│   │   └── auth.$.tsx           ← OAuth handler (auto-generated)
│   ├── shopify.server.ts        ← Shopify config (auto-generated)
│   └── entry.server.tsx
├── services/
│   └── markitdown.py            ← Python MarkItDown service
├── .env                          ← Auto-generated by CLI
├── shopify.app.toml              ← App config with your API keys
├── package.json
├── venv/                         ← Python environment
└── node_modules/
```

***

## 🚀 **Quick Command Summary**

```bash
# 1. Create app (one-time)
npm init @shopify/app@latest -- --template=node
cd product-ingest-ai
npm install
python3 -m venv venv
source venv/bin/activate
pip install 'markitdown[all]' flask openai requests

# 2. Create files
# - Copy markitdown.py to services/markitdown.py
# - Replace app/routes/app._index.tsx with Hello World code above

# 3. Run everything
npm run dev                     # Terminal 1: Shopify app
python services/markitdown.py   # Terminal 2: Python service
```

***

## 🎯 **What You Get Now**

| Feature | Status |
|---------|--------|
| Partner account linked | ✓ Done |
| Dev store created | ✓ Ready |
| App scaffolded | ✓ Ready |
| Hello World UI in Shopify admin | ✓ Ready |
| Python MarkItDown service | ✓ Ready |
| OAuth flow | ✓ Auto-configured |

***

## 📈 **Next Phase: Upload Interface**

Once Hello World is running, the next steps are:

1. **Build drag-and-drop UI component** (React + Polaris)
2. **Create Node backend routes** for file upload → Python service
3. **Add API integration** to call MarkItDown service
4. **Deploy to Fly.io** for production

Want me to generate the **drag-and-drop UI + Node backend routes** now so you can upgrade from Hello World immediately?

Sources
[1] Scaffold an app https://shopify.dev/docs/apps/build/scaffold-app
[2] Update Documentation for Installing Shopify App with ... https://community.shopify.dev/t/update-documentation-for-installing-shopify-app-with-react-and-node-js/27281
[3] How to create a Shopify App - An overview https://www.youtube.com/watch?v=PB9gwBgQIk0
[4] App Home iframe apps https://shopify.dev/docs/api/app-home
