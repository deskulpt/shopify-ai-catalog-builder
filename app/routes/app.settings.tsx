import { useState, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

// ─── Default Settings ─────────────────────────────────────────────────────────
const DEFAULTS = {
  // Crawl
  crawlMaxDepth: 3,
  crawlMaxPages: 200,
  crawlFollowSubdomains: false,
  crawlRespectRobots: true,
  crawlDelayMs: 500,

  // Inclusion / Exclusion
  includeKeywords: "switch, sensor, valve, pump, motor, relay, controller, actuator, transmitter",
  excludeKeywords: "blog, news, about us, careers, privacy, cookie, login, contact us, sitemap",
  includeUrlPatterns: "/product, /catalog, /item, /p/",
  excludeUrlPatterns: "/cart, /account, /checkout, /search, /tag, /wp-admin",
  wildcardKeywords: "industrial, automation, OEM, B2B, specification, datasheet",

  // PDF
  pdfEnabled: true,
  pdfMaxSizeKb: 15000,
  pdfMinSizeKb: 10,
  pdfMaxPages: 20,
  pdfScrapeImages: true,
  pdfMinImageSizeKb: 5,
  pdfMaxImagesPerDoc: 12,

  // AI-Assisted Extraction
  aiExtractionEnabled: true,
  aiExtractionStrategy: "hybrid", // "pattern_based" | "hybrid" | "ai_only"
  aiMaxProductsBeforeFallback: 100,
  anthropicApiKey: "",
  openrouterApiKey: "",
  geminiApiKey: "",
  aiProvider: "anthropic",

  // Specifications
  specMinKeyLength: 3,
  specMaxKeyLength: 30,
  specMaxValueLength: 100,
  specExcludeKeys: "sku, model, image, id, ref",
  specPreferredOrder: "Voltage, Current, Power, Phase, Frequency, Material, IP Rating, Size, Pressure",

  // Description / Content Template
  descriptionTemplate: `## Overview
{{short_description}}

## Key Features
{{feature_bullets}}

## Technical Specifications
{{spec_table}}

## Documents & Downloads
{{file_links}}`,

  descMaxLength: 5000,
  descIncludePdfText: true,
  descMaxPdfTextChars: 2000,
  descStripVendorContact: true,
  descStripNavigation: true,
  descStripPhoneNumbers: true,
  descStripEmails: true,
  descHTMLFormatting: true,

  // Variant grouping
  variantSimilarityThreshold: 45,
  variantAutoGroup: true,
  collectionMatchThreshold: 35,

  // Price / Currency
  defaultCurrency: "USD",
  priceRoundTo: 2,
};

type Settings = typeof DEFAULTS;

const STORAGE_KEY = "ai_catalog_settings_v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    /* ponytail: localStorage may throw (private mode / quota) — fall back to defaults */
  }
  return { ...DEFAULTS };
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (_) {
    /* ponytail: ignore write failures (quota / disabled storage) */
  }
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      border: "1px solid #e1e3e5",
      borderRadius: "8px",
      marginBottom: "16px",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px",
          background: "#f6f6f7",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "14px",
          color: "#1a1a1a",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: "12px", color: "#6d7175" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Field helpers ─────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: "13px", color: "#1a1a1a", marginBottom: "4px", display: "block"
};
const helpStyle: React.CSSProperties = {
  fontSize: "11px", color: "#6d7175", marginTop: "3px"
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: "6px",
  border: "1px solid #c9cccf", fontSize: "13px", boxSizing: "border-box"
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: "monospace"
};
const rowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px"
};

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {help && <p style={helpStyle}>{help}</p>}
    </div>
  );
}

function NumField({ label, help, value, onChange, min, max, step }: {
  label: string; help?: string; value: number;
  onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Field label={label} help={help}>
      <input
        type="number" style={inputStyle}
        value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function TextAreaField({ label, help, value, onChange }: {
  label: string; help?: string; value: string; onChange: (v: string) => void
}) {
  return (
    <Field label={label} help={help}>
      <textarea style={textareaStyle} value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

function Toggle({ label, help, checked, onChange }: {
  label: string; help?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <input
        type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: "16px", height: "16px", marginTop: "2px", cursor: "pointer" }}
      />
      <div>
        <span style={{ fontWeight: 600, fontSize: "13px" }}>{label}</span>
        {help && <p style={helpStyle}>{help}</p>}
      </div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────
export default function SettingsPage() {
  const shopify = useAppBridge();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    saveSettings(settings);

    // If API key is set, also save it to the server
    if (settings.anthropicApiKey) {
      try {
        await fetch("/api/pdf-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_ai_fallback: settings.aiExtractionEnabled,
            strategy: settings.aiExtractionStrategy,
            max_extracted_products: settings.aiMaxProductsBeforeFallback,
            anthropic_api_key: settings.anthropicApiKey,
            openrouter_api_key: settings.openrouterApiKey,
            gemini_api_key: settings.geminiApiKey,
            ai_provider: settings.aiProvider,
          })
        });
      } catch (e) {
        console.error("Failed to save server config:", e);
      }
    }

    setDirty(false);
    shopify.toast.show("Settings saved!");
  };

  const handleReset = () => {
    if (confirm("Reset all settings to defaults?")) {
      setSettings({ ...DEFAULTS });
      saveSettings({ ...DEFAULTS });
      setDirty(false);
      shopify.toast.show("Settings reset to defaults.");
    }
  };

  return (
    <s-page heading="Settings">
      {/* Sticky save bar */}
      {dirty && (
        <div style={{
          position: "sticky", top: 0, zIndex: 100,
          background: "#1a1a1a", color: "white",
          padding: "10px 20px", display: "flex", alignItems: "center",
          justifyContent: "space-between", borderRadius: "6px",
          marginBottom: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
        }}>
          <span style={{ fontSize: "13px" }}>⚠️ You have unsaved changes</span>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => { setSettings(loadSettings()); setDirty(false); }}
              style={{ background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.4)", borderRadius: "5px", padding: "5px 14px", cursor: "pointer", fontSize: "13px" }}
            >Discard</button>
            <button
              onClick={handleSave}
              style={{ background: "#008060", color: "white", border: "none", borderRadius: "5px", padding: "5px 14px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
            >Save Settings</button>
          </div>
        </div>
      )}

      {/* ── 1. CRAWL SETTINGS ── */}
      <Section title="🕷️ Crawl Settings">
        <div style={rowStyle}>
          <NumField label="Max Crawl Depth" help="How many link-hops deep to follow from the start URL." value={settings.crawlMaxDepth} onChange={v => set("crawlMaxDepth", v)} min={1} max={10} />
          <NumField label="Max Pages Per Crawl" help="Hard stop on total pages fetched per job." value={settings.crawlMaxPages} onChange={v => set("crawlMaxPages", v)} min={1} max={2000} />
        </div>
        <div style={rowStyle}>
          <NumField label="Crawl Delay (ms)" help="Milliseconds to wait between each page request." value={settings.crawlDelayMs} onChange={v => set("crawlDelayMs", v)} min={0} max={10000} step={100} />
        </div>
        <Toggle label="Follow Subdomains" help="Also crawl links to subdomains of the root domain (e.g. docs.example.com)." checked={settings.crawlFollowSubdomains} onChange={v => set("crawlFollowSubdomains", v)} />
        <Toggle label="Respect robots.txt" help="Skip URLs that are disallowed in the site's robots.txt." checked={settings.crawlRespectRobots} onChange={v => set("crawlRespectRobots", v)} />
      </Section>

      {/* ── 2. INCLUSION / EXCLUSION RULES ── */}
      <Section title="🔍 Inclusion & Exclusion Rules">
        <TextAreaField
          label="Include Keywords (comma-separated)"
          help="Only pages whose title or content contain at least one of these words will be considered product pages."
          value={settings.includeKeywords}
          onChange={v => set("includeKeywords", v)}
        />
        <TextAreaField
          label="Exclude Keywords (comma-separated)"
          help="Pages whose title or URL contains any of these will be skipped entirely."
          value={settings.excludeKeywords}
          onChange={v => set("excludeKeywords", v)}
        />
        <TextAreaField
          label="Include URL Patterns (comma-separated)"
          help="Only crawl URLs that contain one of these fragments. Leave blank to allow all."
          value={settings.includeUrlPatterns}
          onChange={v => set("includeUrlPatterns", v)}
        />
        <TextAreaField
          label="Exclude URL Patterns (comma-separated)"
          help="Skip any URL that contains one of these fragments."
          value={settings.excludeUrlPatterns}
          onChange={v => set("excludeUrlPatterns", v)}
        />
        <TextAreaField
          label="Wildcard Boost Keywords (comma-separated)"
          help="Pages containing these words are ranked higher as product candidates during extraction."
          value={settings.wildcardKeywords}
          onChange={v => set("wildcardKeywords", v)}
        />
      </Section>

      {/* ── 3. PDF SETTINGS ── */}
      <Section title="📄 PDF Scraping Settings">
        <Toggle label="Enable PDF Extraction" help="Automatically download and extract text & images from linked PDF brochures." checked={settings.pdfEnabled} onChange={v => set("pdfEnabled", v)} />
        <div style={rowStyle}>
          <NumField label="PDF Max Size (KB)" help="PDFs larger than this are skipped." value={settings.pdfMaxSizeKb} onChange={v => set("pdfMaxSizeKb", v)} min={100} max={100000} step={500} />
          <NumField label="PDF Min Size (KB)" help="PDFs smaller than this are ignored (likely empty)." value={settings.pdfMinSizeKb} onChange={v => set("pdfMinSizeKb", v)} min={1} max={500} />
        </div>
        <div style={rowStyle}>
          <NumField label="Max Pages to Scrape Per PDF" help="Stop reading after this many pages per document." value={settings.pdfMaxPages} onChange={v => set("pdfMaxPages", v)} min={1} max={200} />
        </div>
        <Toggle label="Extract Images from PDFs" help="Pull embedded images from PDF pages and add them to the product gallery." checked={settings.pdfScrapeImages} onChange={v => set("pdfScrapeImages", v)} />
        <div style={rowStyle}>
          <NumField label="Min Image Size (KB)" help="PDF images smaller than this are treated as icons/bullets and skipped." value={settings.pdfMinImageSizeKb} onChange={v => set("pdfMinImageSizeKb", v)} min={1} max={500} />
          <NumField label="Max Images Per PDF" help="Cap on how many images are extracted from a single PDF." value={settings.pdfMaxImagesPerDoc} onChange={v => set("pdfMaxImagesPerDoc", v)} min={1} max={100} />
        </div>
      </Section>

      {/* ── AI-ASSISTED EXTRACTION SETTINGS ── */}
      <Section title="🤖 AI-Assisted PDF Extraction">
        <Toggle
          label="Enable AI Fallback for Complex PDFs"
          help="When pattern-based extraction produces too many products or invalid SKUs, automatically use Claude AI (requires API key)."
          checked={settings.aiExtractionEnabled}
          onChange={v => set("aiExtractionEnabled", v)}
        />
        <Field label="Extraction Strategy" help="Pattern-based is fast and free. Hybrid uses AI only when needed. AI-only always uses Claude.">
          <select
            style={{...inputStyle, cursor: "pointer"}}
            value={settings.aiExtractionStrategy}
            onChange={e => set("aiExtractionStrategy", e.target.value as any)}
          >
            <option value="pattern_based">Pattern-Based Only (Fastest, Free)</option>
            <option value="hybrid">Hybrid - AI as Last Resort (Recommended)</option>
            <option value="ai_only">AI-Only (Most Accurate, Costs API Tokens)</option>
          </select>
        </Field>
        <NumField
          label="Max Products Before AI Fallback"
          help="If pattern-based extraction produces more products than this, use AI instead."
          value={settings.aiMaxProductsBeforeFallback}
          onChange={v => set("aiMaxProductsBeforeFallback", v)}
          min={20}
          max={500}
        />
        <Field
          label="Anthropic API Key"
          help={`Your Claude API key (kept secure on server, never sent to browser). Get one at ${
            'https://console.anthropic.com'
          }`}
        >
          <input
            type="password"
            placeholder="sk-ant-..."
            style={{...inputStyle}}
            value={settings.anthropicApiKey}
            onChange={e => set("anthropicApiKey", e.target.value)}
          />
          {settings.anthropicApiKey && (
            <p style={{...helpStyle, color: "#2d7f3a"}}>✓ API key configured</p>
          )}
          {!settings.anthropicApiKey && settings.aiExtractionEnabled && (
            <p style={{...helpStyle, color: "#c23729"}}>⚠️ No API key – AI fallback will be skipped</p>
          )}
        </Field>
        <Field
          label="OpenRouter API Key"
          help={`Optional. Routes AI calls through OpenRouter (works with many models). Get one at ${
            'https://openrouter.ai/keys'
          }`}
        >
          <input
            type="password"
            placeholder="sk-or-..."
            style={{...inputStyle}}
            value={settings.openrouterApiKey}
            onChange={e => set("openrouterApiKey", e.target.value)}
          />
          {settings.openrouterApiKey && (
            <p style={{...helpStyle, color: "#2d7f3a"}}>✓ OpenRouter key configured</p>
          )}
        </Field>
        <Field
          label="Gemini API Key"
          help={`Optional. Google Gemini for AI extraction. Get one at ${
            'https://aistudio.google.com/apikey'
          }`}
        >
          <input
            type="password"
            placeholder="AIza..."
            style={{...inputStyle}}
            value={settings.geminiApiKey}
            onChange={e => set("geminiApiKey", e.target.value)}
          />
          {settings.geminiApiKey && (
            <p style={{...helpStyle, color: "#2d7f3a"}}>✓ Gemini key configured</p>
          )}
        </Field>
      </Section>

      {/* ── 4. SPECIFICATION SETTINGS ── */}
      <Section title="🔧 Specification Extraction Settings">
        <div style={rowStyle}>
          <NumField label="Min Key Length (chars)" help="Specification keys shorter than this are ignored." value={settings.specMinKeyLength} onChange={v => set("specMinKeyLength", v)} min={1} max={10} />
          <NumField label="Max Key Length (chars)" help="Specification keys longer than this are skipped." value={settings.specMaxKeyLength} onChange={v => set("specMaxKeyLength", v)} min={10} max={60} />
        </div>
        <NumField label="Max Value Length (chars)" help="Specification values longer than this will be truncated." value={settings.specMaxValueLength} onChange={v => set("specMaxValueLength", v)} min={20} max={500} />
        <TextAreaField
          label="Exclude Spec Keys (comma-separated)"
          help="These exact key names will be filtered out from the spec table."
          value={settings.specExcludeKeys}
          onChange={v => set("specExcludeKeys", v)}
        />
        <TextAreaField
          label="Preferred Spec Display Order (comma-separated)"
          help="Specs matching these names will appear first in the table, in this order."
          value={settings.specPreferredOrder}
          onChange={v => set("specPreferredOrder", v)}
        />
      </Section>

      {/* ── 5. DESCRIPTION & CONTENT TEMPLATE ── */}
      <Section title="📝 Description & Content Template">
        <div style={{
          background: "#f0f6ff", border: "1px solid #c4d9ff",
          borderRadius: "6px", padding: "10px 14px", fontSize: "12px", color: "#334"
        }}>
          <strong>Available template variables:</strong><br />
          <code style={{ lineHeight: "2" }}>
            {"{{short_description}}"} · {"{{feature_bullets}}"} · {"{{spec_table}}"} · {"{{file_links}}"} · {"{{images}}"} · {"{{pdf_text}}"} · {"{{title}}"} · {"{{sku}}"}
          </code>
        </div>
        <TextAreaField
          label="Description HTML Template"
          help="Structure of the product description. Variables are filled in at publish time."
          value={settings.descriptionTemplate}
          onChange={v => set("descriptionTemplate", v)}
        />
        <div style={rowStyle}>
          <NumField label="Max Description Length (chars)" help="Descriptions longer than this will be trimmed." value={settings.descMaxLength} onChange={v => set("descMaxLength", v)} min={500} max={50000} step={500} />
          <NumField label="Max PDF Text Length (chars)" help="How much raw PDF text to include in the description." value={settings.descMaxPdfTextChars} onChange={v => set("descMaxPdfTextChars", v)} min={100} max={20000} step={100} />
        </div>
        <Toggle label="Include PDF Text in Description" help="Append extracted PDF brochure content below the main description." checked={settings.descIncludePdfText} onChange={v => set("descIncludePdfText", v)} />
        <Toggle label="HTML Formatting" help="Convert scraped markdown to clean HTML before publishing." checked={settings.descHTMLFormatting} onChange={v => set("descHTMLFormatting", v)} />
        <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: "12px" }}>
          <p style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>Smart Cleanup Rules</p>
          <Toggle label="Strip Vendor / Manufacturer Contact Info" help='Remove "Manufactured by:", phone numbers, email addresses, addresses from descriptions.' checked={settings.descStripVendorContact} onChange={v => set("descStripVendorContact", v)} />
          <div style={{ marginTop: "8px" }}>
            <Toggle label="Strip Navigation / UI Chrome" help="Remove menu items, breadcrumbs, and other site navigation that gets scraped." checked={settings.descStripNavigation} onChange={v => set("descStripNavigation", v)} />
          </div>
          <div style={{ marginTop: "8px" }}>
            <Toggle label="Strip Phone Numbers" help="Automatically remove phone/fax numbers from descriptions." checked={settings.descStripPhoneNumbers} onChange={v => set("descStripPhoneNumbers", v)} />
          </div>
          <div style={{ marginTop: "8px" }}>
            <Toggle label="Strip Email Addresses" help="Automatically remove email addresses from descriptions." checked={settings.descStripEmails} onChange={v => set("descStripEmails", v)} />
          </div>
        </div>
      </Section>

      {/* ── 6. VARIANT GROUPING ── */}
      <Section title="🧩 Variant Grouping & Collection Matching">
        <Toggle label="Auto-Group Similar Products as Variants" help="When enabled, the catalog tree will automatically group similar product names into a parent product with variants." checked={settings.variantAutoGroup} onChange={v => set("variantAutoGroup", v)} />
        <div style={rowStyle}>
          <Field label="Variant Similarity Threshold (%)" help="Minimum combined similarity score (0–100) for two products to be grouped as variants. Lower = more aggressive grouping.">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="range" min={10} max={90} value={settings.variantSimilarityThreshold}
                onChange={e => set("variantSimilarityThreshold", Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontWeight: 700, fontSize: "14px", minWidth: "40px", textAlign: "right" }}>
                {settings.variantSimilarityThreshold}%
              </span>
            </div>
          </Field>
          <Field label="Collection Match Threshold (%)" help="Minimum score for a product group to be auto-matched to an existing Shopify collection.">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="range" min={10} max={90} value={settings.collectionMatchThreshold}
                onChange={e => set("collectionMatchThreshold", Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontWeight: 700, fontSize: "14px", minWidth: "40px", textAlign: "right" }}>
                {settings.collectionMatchThreshold}%
              </span>
            </div>
          </Field>
        </div>
      </Section>

      {/* ── 7. PRICE / CURRENCY ── */}
      <Section title="💰 Price & Currency Defaults">
        <div style={rowStyle}>
          <Field label="Default Currency Code" help="Used when no currency is detected on the scraped page.">
            <select
              value={settings.defaultCurrency}
              onChange={e => set("defaultCurrency", e.target.value)}
              style={inputStyle}
            >
              {["USD","CAD","EUR","GBP","AUD","INR","JPY","CNY","CHF","SGD","AED","SAR","BRL","MXN","ZAR","KRW","HKD","NOK","SEK","DKK","NZD","THB","MYR","IDR","PHP","PKR","BDT"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <NumField label="Price Decimal Places" help="Number of decimal places to round extracted prices to." value={settings.priceRoundTo} onChange={v => set("priceRoundTo", v)} min={0} max={4} />
        </div>
      </Section>

      {/* ── Footer Actions ── */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button
          onClick={handleReset}
          style={{ padding: "9px 20px", borderRadius: "6px", border: "1px solid #c9cccf", background: "white", cursor: "pointer", fontSize: "13px" }}
        >Reset to Defaults</button>
        <button
          onClick={handleSave}
          style={{ padding: "9px 20px", borderRadius: "6px", border: "none", background: "#008060", color: "white", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
        >Save Settings</button>
      </div>
    </s-page>
  );
}
