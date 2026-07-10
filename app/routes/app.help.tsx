import { useState } from "react";

// ─── Section toggle ───────────────────────────────────────────────────────────
function DocSection({ id, emoji, title, children }: {
  id: string; emoji: string; title: string; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      id={id}
      style={{
        border: "1px solid #e1e3e5",
        borderRadius: "10px",
        marginBottom: "18px",
        overflow: "hidden",
        scrollMarginTop: "80px",
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          background: "linear-gradient(135deg, #f6f6f7 0%, #f0f0f2 100%)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "15px", color: "#1a1a1a" }}>
          {emoji}&nbsp; {title}
        </span>
        <span style={{ fontSize: "11px", color: "#6d7175" }}>{open ? "▲ collapse" : "▼ expand"}</span>
      </button>
      {open && (
        <div style={{ padding: "20px 24px", lineHeight: "1.7", color: "#3b3b3b", fontSize: "13.5px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontWeight: 700, fontSize: "14px", margin: "16px 0 6px", color: "#1a1a1a" }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "6px 0 10px" }}>{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul style={{ paddingLeft: "20px", margin: "6px 0 12px" }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: "4px" }} dangerouslySetInnerHTML={{ __html: item }} />
      ))}
    </ul>
  );
}

function Callout({ type, children }: { type: "tip" | "note" | "warning"; children: React.ReactNode }) {
  const styles: Record<string, { bg: string; border: string; color: string; icon: string }> = {
    tip: { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534", icon: "💡" },
    note: { bg: "#f0f6ff", border: "#c4d9ff", color: "#1e3a5f", icon: "ℹ️" },
    warning: { bg: "#fff7ed", border: "#fed7aa", color: "#9a3412", icon: "⚠️" },
  };
  const s = styles[type];
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: "7px", padding: "10px 14px", margin: "10px 0", fontSize: "13px"
    }}>
      {s.icon}&nbsp;{children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      background: "#f0f0f2", padding: "1px 6px", borderRadius: "4px",
      fontFamily: "monospace", fontSize: "12px"
    }}>
      {children}
    </code>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "14px", marginBottom: "16px" }}>
      <div style={{
        width: "28px", height: "28px", borderRadius: "50%",
        background: "#008060", color: "white", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: "13px", marginTop: "1px"
      }}>
        {n}
      </div>
      <div>
        <strong style={{ fontSize: "13.5px" }}>{title}</strong>
        <div style={{ color: "#3b3b3b", fontSize: "13px", marginTop: "3px" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── TOC ──────────────────────────────────────────────────────────────────────
const TOC_ITEMS = [
  { id: "overview", label: "App Overview" },
  { id: "quickstart", label: "Quick Start" },
  { id: "crawling", label: "Crawling & URL Ingestion" },
  { id: "extraction", label: "Product Extraction" },
  { id: "pdf", label: "PDF Brochures" },
  { id: "variants", label: "Variant Grouping" },
  { id: "collections", label: "Collection Matching" },
  { id: "publishing", label: "Publishing to Shopify" },
  { id: "settings-ref", label: "Settings Reference" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "faq", label: "FAQ" },
  { id: "support", label: "Get Support" },
];

export default function HelpPage() {
  return (
    <s-page heading="Help & Documentation">
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "24px", alignItems: "start" }}>

        {/* ── Sticky TOC sidebar ── */}
        <div style={{
          position: "sticky", top: "16px",
          background: "#f6f6f7", border: "1px solid #e1e3e5",
          borderRadius: "10px", padding: "16px", fontSize: "13px"
        }}>
          <p style={{ fontWeight: 700, marginBottom: "10px", color: "#1a1a1a" }}>Contents</p>
          {TOC_ITEMS.map(item => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{ display: "block", padding: "4px 0", color: "#008060", textDecoration: "none", lineHeight: "1.5" }}
            >
              {item.label}
            </a>
          ))}
          <div style={{ borderTop: "1px solid #e1e3e5", marginTop: "12px", paddingTop: "12px" }}>
            <a
              href="/app/settings"
              style={{ display: "block", fontWeight: 600, color: "#333", textDecoration: "none", fontSize: "12px" }}
            >
              ⚙️ Go to Settings →
            </a>
          </div>
        </div>

        {/* ── Main content ── */}
        <div>

          {/* MARKETING / ONBOARDING HERO */}
          <div style={{
            background: "linear-gradient(135deg, #008060 0%, #004c3f 100%)",
            color: "white", borderRadius: "12px", padding: "28px 32px",
            marginBottom: "24px", boxShadow: "0 4px 14px rgba(0,128,96,0.18)"
          }}>
            <h1 style={{ margin: "0 0 8px", fontSize: "22px", fontWeight: 800 }}>Welcome to AI Catalog Builder 🚀</h1>
            <p style={{ margin: "0 0 14px", fontSize: "14px", lineHeight: 1.6, opacity: 0.95, maxWidth: "640px" }}>
              Turn any supplier or manufacturer website into a structured, SEO-ready Shopify catalog —
              automatically. Crawl product pages, extract specs and images, parse PDF brochures, group
              variants, and publish clean DRAFT listings in minutes instead of hours of manual entry.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <a href="#quickstart" style={{ background: "white", color: "#008060", padding: "9px 18px", borderRadius: "7px", fontWeight: 700, textDecoration: "none", fontSize: "13px" }}>Start in 5 steps →</a>
              <a href="#support" style={{ background: "rgba(255,255,255,0.15)", color: "white", padding: "9px 18px", borderRadius: "7px", fontWeight: 600, textDecoration: "none", fontSize: "13px" }}>Get Support</a>
            </div>
          </div>

          {/* OVERVIEW */}
          <DocSection id="overview" emoji="🚀" title="App Overview">
            <P>
              <strong>AI Catalog Builder</strong> is a Shopify-embedded tool that turns any B2B supplier
              or manufacturer website into a structured product catalog in your store — automatically.
            </P>
            <P>It crawls product pages, extracts specifications and images, parses PDF brochures,
              groups product variants intelligently, and publishes clean, SEO-ready product listings to Shopify as DRAFTs for your review.</P>
            <H>What it does</H>
            <UL items={[
              "<strong>Web Crawling</strong> — Follows links from a start URL, respects robots.txt, and discovers product pages automatically.",
              "<strong>Structured Extraction</strong> — Pulls title, SKU, price (with currency), specs, images, and file links from any page.",
              "<strong>PDF Enrichment</strong> — Downloads linked PDF brochures, extracts text content and embedded images.",
              "<strong>Variant Grouping</strong> — Intelligently groups similar products (e.g. same model in different voltages) as Shopify variants.",
              "<strong>Collection Matching</strong> — Fuzzy-matches product groups to your existing Shopify collections to avoid duplicates.",
              "<strong>Publishing</strong> — Creates Shopify products with media, metafields, variant options, and SKUs.",
            ]} />
          </DocSection>

          {/* QUICK START */}
          <DocSection id="quickstart" emoji="⚡" title="Quick Start">
            <Step n={1} title="Enter a supplier URL">
              Paste the homepage or catalog page URL of your supplier/manufacturer into the <strong>URL input</strong> at the top of the Catalog Ingest page and click <strong>Crawl & Discover</strong>.
            </Step>
            <Step n={2} title="Review discovered categories & products">
              The app shows a collapsible tree of discovered categories and product pages. Use checkboxes to select which products to import.
            </Step>
            <Step n={3} title="(Optional) Enable Intelligent Grouping">
              Toggle <strong>"Intelligently group similar series / variants"</strong> to automatically cluster related models. The app will fuzzy-match to your existing Shopify collections too.
            </Step>
            <Step n={4} title="Queue selected products">
              Click <strong>"Add to Queue"</strong>. The system begins extracting each product page in the background.
            </Step>
            <Step n={5} title="Review & Publish">
              Click any queued source to open the <strong>Review Modal</strong>. Edit title, price, specs, choose which images and files to include, then click <strong>Publish to Shopify</strong>.
            </Step>
            <Callout type="tip">
              Products are always published as <strong>DRAFT</strong> — you control when they go live.
            </Callout>
          </DocSection>

          {/* CRAWLING */}
          <DocSection id="crawling" emoji="🕷️" title="Crawling & URL Ingestion">
            <H>Supported input types</H>
            <UL items={[
              "<strong>Full site URL</strong> — e.g. <code>https://supplier.com/products/</code> — crawls all linked product pages.",
              "<strong>Single product URL</strong> — Extracts just that one product.",
              "<strong>URL with parameters</strong> — Strips known tracking parameters automatically (e.g. supplier tracking <code>?pos=5&kwd=...</code>).",
              "<strong>File upload</strong> — Upload a <code>.txt</code>, <code>.html</code>, or <code>.md</code> file containing product information.",
            ]} />
            <H>Crawl depth & limits</H>
            <P>
              The crawler follows links up to <strong>Max Crawl Depth</strong> hops from the start URL.
              You can set this in <a href="/app/settings#crawl">Settings → Crawl Settings</a>.
              A depth of 1 only processes the start page; depth 3 follows 3 levels of links.
            </P>
            <H>Fragment URLs (page anchors)</H>
            <P>
              URLs with <Code>#fragment</Code> identifiers (e.g. <Code>example.com/page#product-A</Code>) are
              supported. The crawler fetches the full page and uses the fragment to identify which section corresponds to the product.
            </P>
            <Callout type="note">
              Export URLs with long parameter strings are handled — the app strips noise parameters
              and resolves the canonical product URL automatically.
            </Callout>
          </DocSection>

          {/* EXTRACTION */}
          <DocSection id="extraction" emoji="⚙️" title="Product Extraction">
            <H>What gets extracted</H>
            <UL items={[
              "<strong>Title</strong> — First heading on the page (H1–H6).",
              "<strong>SKU / Model</strong> — Detected from common patterns like <code>SKU:</code>, <code>Model No:</code>, or uppercase codes like <code>AB-100</code>.",
              "<strong>Price & Currency</strong> — Recognises ₹ (INR), $ (USD/CAD), £ (GBP), € (EUR), ¥ (JPY), and 50+ other world currencies. Extracts per-unit pricing (e.g. ₹ 22 per piece).",
              "<strong>Purchase Type</strong> — Detects <em>Quote Only</em> products when terms like 'RFQ', 'Call for price', 'Request a quote' appear.",
              "<strong>Specifications</strong> — Parsed from inline <code>Key: Value</code> pairs and markdown tables.",
              "<strong>Images</strong> — All product images found on the page.",
              "<strong>File links</strong> — PDFs, ZIP files, datasheets, and linked catalog viewers.",
            ]} />
            <H>Multi-product pages</H>
            <P>
              When a single URL contains multiple distinct products (e.g. a product family page),
              the app detects this and offers a <strong>"Split into N products"</strong> option.
              Each product gets its own entry in the queue.
            </P>
            <H>Quantity & unit detection</H>
            <P>
              The app maps scraped price units to Shopify's <Code>price_unit</Code> metafield.
              Units like <em>per piece</em>, <em>per kg</em>, <em>per meter</em>, <em>per set</em> are recognised
              across metric and imperial systems. Currency values are normalised to 2 decimal places.
            </P>
          </DocSection>

          {/* PDF */}
          <DocSection id="pdf" emoji="📄" title="PDF Brochures">
            <H>Automatic PDF detection</H>
            <P>
              The app detects links to PDF files from scraped pages, including:
            </P>
            <UL items={[
              "Direct <code>.pdf</code> links",
              "Embedded PDF viewer URLs (e.g. <code>pdf.supplier.com/viewer/...</code>)",
              "Online catalog viewer URLs",
              "Links with text like <em>Product Brochure</em>, <em>Datasheet</em>, <em>Technical Manual</em>",
            ]} />
            <H>What is extracted from PDFs</H>
            <UL items={[
              "<strong>Text content</strong> — Converted to markdown and appended to the product description.",
              "<strong>Embedded images</strong> — Added to the product image gallery (filtered to ≥ 5KB by default).",
            ]} />
            <H>PDF page viewer hop</H>
            <P>
              Some PDFs are hosted inside HTML viewer pages (e.g. custom <Code>/viewer/</Code> pages).
              The app automatically resolves these by following the viewer URL and triggering the download.
            </P>
            <Callout type="warning">
              Some suppliers host PDFs behind SSL certificates with hostname mismatches — these will be skipped with an error in the logs. This is a server-side restriction on the supplier's end.
            </Callout>
            <H>Iframe embedding</H>
            <P>
              For catalog viewers that cannot be directly downloaded (e.g. complex online viewers),
              you can toggle <strong>"Embed as Iframe"</strong> in the Review Modal. This inserts an interactive
              catalog viewer directly inside the product description.
            </P>
          </DocSection>

          {/* VARIANTS */}
          <DocSection id="variants" emoji="🧩" title="Variant Grouping">
            <H>How grouping works</H>
            <P>
              When you enable <strong>Intelligently group similar series / variants</strong>, the app
              scores each product against existing clusters using three signals:
            </P>
            <UL items={[
              "<strong>Jaccard word overlap (50%)</strong> — Shared meaningful words between two product names.",
              "<strong>Longest common token prefix (30%)</strong> — How many leading words match in order.",
              "<strong>SKU family prefix (20%)</strong> — Products with the same uppercase letter prefix (e.g. <code>PCS-100</code> and <code>PCS-200</code>) get a bonus.",
            ]} />
            <H>Option inference</H>
            <P>The differing part of each variant name is parsed into structured option dimensions:</P>
            <UL items={[
              "Voltage — <code>24V</code>, <code>220VAC</code>, <code>12VDC</code>",
              "Current — <code>16A</code>, <code>32 Amp</code>",
              "Power — <code>5kW</code>, <code>10HP</code>",
              "Phase — <code>Single Phase</code>, <code>3 Phase</code>",
              "IP Rating — <code>IP65</code>, <code>IP67</code>",
              "Material — <code>Stainless Steel</code>, <code>Brass</code>, <code>PVC</code>",
              "Connection — <code>NPT</code>, <code>Flanged</code>, <code>Threaded</code>",
              "Mounting — <code>DIN Rail</code>, <code>Panel Mount</code>",
              "Contact Type — <code>NO</code>, <code>NC</code>, <code>SPDT</code>",
            ]} />
            <H>Adjusting sensitivity</H>
            <P>
              The grouping threshold (default 45%) can be adjusted in <a href="/app/settings">Settings → Variant Grouping</a>.
              Lowering it causes more products to be grouped together; raising it keeps more products separate.
            </P>
          </DocSection>

          {/* COLLECTIONS */}
          <DocSection id="collections" emoji="📁" title="Collection Matching">
            <H>Why collection matching matters</H>
            <P>
              Without collection matching, every import run could create duplicate or near-duplicate
              collections (e.g. "Pressure Switches", "Pressure Switch", "Pressure Sensors").
              The app compares each product group against your <strong>existing Shopify collections</strong>
              and suggests the best match.
            </P>
            <H>How it works</H>
            <UL items={[
              "When Intelligent Grouping is toggled on, the app fetches all your Shopify collections (up to 1,000).",
              "Each product group title is fuzzy-matched to collection names using the same similarity engine.",
              "Groups with a match ≥ 35% (configurable) show a green badge with the match confidence.",
              "Groups with no match show an orange <em>New Collection</em> badge.",
              "You can override any auto-match using the collection dropdown next to each group.",
            ]} />
            <H>Summary bar</H>
            <P>
              After grouping, a summary bar shows: <em>X matched to existing · Y new collections · Z total groups</em>.
              This gives you an instant overview before committing to publish.
            </P>
            <Callout type="tip">
              Use the dropdown <strong>＋ Create new collection</strong> option to force creation of a new
              collection even when an auto-match is shown.
            </Callout>
          </DocSection>

          {/* PUBLISHING */}
          <DocSection id="publishing" emoji="🛍️" title="Publishing to Shopify">
            <H>Review Modal</H>
            <P>Before publishing, the Review Modal lets you:</P>
            <UL items={[
              "Edit the product <strong>title, description, SKU, and price</strong>",
              "Toggle individual <strong>specifications</strong> on/off",
              "Select which <strong>images</strong> to include in the gallery",
              "Select which <strong>PDF/file links</strong> to include as downloads",
              "Configure <strong>variants and option values</strong>",
              "Set <strong>purchase type</strong> (Direct Buy vs. Quote Only)",
            ]} />
            <H>What gets created in Shopify</H>
            <UL items={[
              "<strong>Product</strong> (status: DRAFT) with title and HTML description",
              "<strong>Variants</strong> with option values, price, SKU, and inventory settings",
              "<strong>Media gallery</strong> — images uploaded from the scraped URLs",
              "<strong>Metafields</strong> — <code>$app.purchase_type</code>, <code>$app.price_currency</code>, <code>$app.price_unit</code>",
              "<strong>Files</strong> — PDFs and documents uploaded to Shopify Files",
            ]} />
            <H>Quote-only products</H>
            <P>
              When a product is marked as <em>Quote Only</em>, the variant price is set to <Code>0.00</Code>,
              inventory tracking is disabled, and <Code>inventoryPolicy</Code> is set to <Code>CONTINUE</Code>
              so the product remains purchasable (for enquiry flow).
            </P>
            <Callout type="note">
              All products are published as <strong>DRAFT</strong>. You must manually set them to Active
              in your Shopify admin when ready.
            </Callout>
          </DocSection>

          {/* SETTINGS REFERENCE */}
          <DocSection id="settings-ref" emoji="⚙️" title="Settings Reference">
            <P>All settings are stored in your browser's <Code>localStorage</Code> and applied to every subsequent scrape and publish action.</P>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                <thead>
                  <tr style={{ background: "#f6f6f7" }}>
                    {["Setting", "Default", "Description"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #e1e3e5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Max Crawl Depth", "3", "Link-hop depth from start URL"],
                    ["Max Pages Per Crawl", "200", "Hard stop on pages per job"],
                    ["Crawl Delay (ms)", "500", "Wait between page requests"],
                    ["PDF Max Size (KB)", "15,000", "Skip PDFs larger than this"],
                    ["PDF Max Pages", "20", "Pages to read per PDF"],
                    ["PDF Min Image Size (KB)", "5", "Ignore tiny icon images from PDFs"],
                    ["Spec Max Key Length", "30", "Filter out overly long spec keys"],
                    ["Max Description Length", "5,000", "Trim descriptions beyond this"],
                    ["Variant Similarity Threshold", "45%", "Minimum score to group two products"],
                    ["Collection Match Threshold", "35%", "Minimum score to suggest a collection"],
                    ["Default Currency", "USD", "Fallback when no currency detected"],
                  ].map(([s, d, desc], i) => (
                    <tr key={s} style={{ background: i % 2 === 0 ? "white" : "#fafbfb" }}>
                      <td style={{ padding: "7px 12px", borderBottom: "1px solid #f0f0f0", fontWeight: 500 }}>{s}</td>
                      <td style={{ padding: "7px 12px", borderBottom: "1px solid #f0f0f0", fontFamily: "monospace" }}>{d}</td>
                      <td style={{ padding: "7px 12px", borderBottom: "1px solid #f0f0f0" }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P><a href="/app/settings">→ Open Settings page</a> to configure all of these.</P>
          </DocSection>

          {/* TROUBLESHOOTING */}
          <DocSection id="troubleshooting" emoji="🔧" title="Troubleshooting">
            <H>Python service is offline</H>
            <P>
              The red <strong>Python Service Offline</strong> banner means the Flask extraction
              microservice is not running. Start it with:
            </P>
            <div style={{ background: "#1a1a1a", color: "#a8ff78", padding: "12px 16px", borderRadius: "7px", fontFamily: "monospace", fontSize: "12px" }}>
              cd services && ../.venv/bin/python markitdown_service.py
            </div>

            <H>Publishing failed: Variable $variants invalid value for sku</H>
            <P>
              This was a known issue (SKU was placed at variant root instead of inside <Code>inventoryItem</Code>).
              It is fixed in the current version. Ensure you have the latest code.
            </P>

            <H>No products found after crawling</H>
            <UL items={[
              "The site may require JavaScript rendering — only static HTML is currently supported.",
              "Check your <strong>Include/Exclude URL Patterns</strong> in Settings — patterns may be too restrictive.",
              "The page may be behind a login or region-lock.",
              "Try a direct product page URL instead of the homepage.",
            ]} />

            <H>PDF not downloading</H>
            <UL items={[
              "The supplier's SSL certificate may be invalid (hostname mismatch) — this cannot be bypassed.",
              "The PDF may be behind authentication or a CAPTCHA.",
              "Try copying the direct PDF URL and pasting it separately into the URL input.",
            ]} />

            <H>Images not appearing in Shopify</H>
            <P>
              Shopify pulls images directly from the original URL at publish time. If the supplier
              server blocks direct hotlinking, the image won't load. Manually download and re-upload
              the image in Shopify admin.
            </P>

            <H>Variant grouping creates wrong groups</H>
            <P>
              Raise the <strong>Variant Similarity Threshold</strong> in Settings (e.g. from 45% to 60%)
              to make grouping more conservative. If two products keep getting grouped incorrectly,
              their names are likely too similar — rename one after publishing.
            </P>
          </DocSection>

          {/* FAQ */}
          <DocSection id="faq" emoji="❓" title="FAQ">
            {[
              {
                q: "Does this replace manual product entry?",
                a: "Yes for bulk imports from supplier websites. You still review and approve every product before it goes live."
              },
              {
                q: "Can I import from any website?",
                a: "Any publicly accessible static HTML page. Sites that require login, use heavy JavaScript rendering, or have aggressive bot protection may not work."
              },
              {
                q: "Will this create duplicate products?",
                a: "The app always creates new products — it does not check for existing products with the same title. Use the Queue to manage what you import and review before publishing."
              },
              {
                q: "Can I import in bulk?",
                a: "Yes — crawl a category page, select all products in a category, queue them, then extract and publish each one. The queue persists until cleared."
              },
              {
                q: "What currency symbols are supported?",
                a: "All major world currencies: USD ($), CAD ($), EUR (€), GBP (£), INR (₹), JPY (¥), CNY (¥), AED (د.إ), SAR (﷼), BRL (R$), and 50+ others."
              },
              {
                q: "How does Quote Only work with Shopify?",
                a: "Price is set to 0.00 and inventory policy is CONTINUE so the product appears available. You can use Shopify's price-hiding features or a contact form app to handle the enquiry flow."
              },
              {
                q: "Are products published as Active?",
                a: "No — always as DRAFT. You manually activate them in Shopify admin when satisfied."
              },
              {
                q: "Can I re-import a product to update it?",
                a: "Not currently — the app only creates new products. Update existing products directly in Shopify admin."
              },
            ].map(({ q, a }) => (
              <div key={q} style={{ marginBottom: "14px", padding: "12px 16px", background: "#fafbfb", borderRadius: "7px", border: "1px solid #f0f0f0" }}>
                <p style={{ fontWeight: 700, margin: "0 0 5px", fontSize: "13.5px", color: "#1a1a1a" }}>Q: {q}</p>
                <p style={{ margin: 0, color: "#3b3b3b" }}>A: {a}</p>
              </div>
            ))}
          </DocSection>

          {/* GET SUPPORT */}
          <DocSection id="support" emoji="💬" title="Get Support">
            <P>Stuck, or want help onboarding your first catalog? Our team is happy to help.</P>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "6px" }}>
              <a href="mailto:hello@deskulpt.com" style={{ background: "#008060", color: "white", padding: "12px 22px", borderRadius: "8px", fontWeight: 700, textDecoration: "none", fontSize: "14px" }}>
                ✉️ Email hello@deskulpt.com
              </a>
              <a href="https://deskulpt.com" target="_blank" rel="noopener noreferrer" style={{ background: "white", border: "1px solid #c9cccf", color: "#1a1c1d", padding: "12px 22px", borderRadius: "8px", fontWeight: 600, textDecoration: "none", fontSize: "14px" }}>
                Visit deskulpt.com →
              </a>
            </div>
            <Callout type="note">
              Include your store name and the supplier URL you're importing — we'll get back to you within one business day.
            </Callout>
          </DocSection>

        </div>
      </div>
    </s-page>
  );
}
