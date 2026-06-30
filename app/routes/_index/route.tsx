import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => {
  return [
    { title: "Deskulpt Product AI Ingester - Automated Shopify Catalog Onboarding" },
    { name: "description", content: "Import PDFs, documents, spreadsheets, and crawl websites using AI to ingest and publish products to Shopify in seconds." },
  ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      {/* Header / Navbar */}
      <header className={styles.header}>
        <div className={styles.logoContainer}>
          <div className={styles.logoIcon}>⚡</div>
          <span className={styles.logoText}>Deskulpt Product AI</span>
        </div>
        <nav className={styles.headerNav}>
          <a href="#features" className={styles.navLink}>Features</a>
          <a href="#workflow" className={styles.navLink}>Workflow</a>
          <a href="#faqs" className={styles.navLink}>FAQs</a>
        </nav>
      </header>

      {/* Main Content */}
      <div className={styles.content}>
        
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.badge}>
            <span>🚀</span> Shopify Catalog Automation
          </div>
          <h1 className={styles.heroTitle}>
            Transform Catalogs & Websites <br />
            into Shopify Products in Seconds
          </h1>
          <p className={styles.heroTagline}>
            Automate your catalog onboarding. Upload PDFs, DOCX, spreadsheets, or crawl vendor websites. Let AI convert them to clean markdown, extract rich product options, map metafields, and publish directly to Shopify.
          </p>

          {/* Login/Installation Card */}
          {showForm && (
            <div className={styles.loginCard}>
              <h2 className={styles.loginCardTitle}>Connect your Shopify store to get started</h2>
              <Form className={styles.form} method="post" action="/auth/login">
                <div className={styles.inputWrapper}>
                  <span className={styles.inputPrefix}>https://</span>
                  <input
                    className={styles.input}
                    type="text"
                    name="shop"
                    placeholder="my-shop-domain.myshopify.com"
                    required
                  />
                </div>
                <button className={styles.button} type="submit">
                  Install & Launch
                  <svg className={styles.btnArrow} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </Form>
              <p className={styles.inputHelper}>
                Enter your Shopify store URL to securely install the app and begin ingesting.
              </p>
            </div>
          )}
        </section>

        {/* Stats Section */}
        <section className={styles.statsContainer}>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>10x</span>
            <span className={styles.statLabel}>Faster Onboarding</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>99%</span>
            <span className={styles.statLabel}>AI Extraction Accuracy</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>100s</span>
            <span className={styles.statLabel}>Of Manual Hours Saved</span>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className={styles.features}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Built for Complex Catalog Onboarding</h2>
            <p className={styles.sectionSubtitle}>
              Everything you need to turn raw vendor catalogs, spec sheets, and web pages into highly structured Shopify product listings.
            </p>
          </div>

          <div className={styles.featureGrid}>
            
            {/* Feature 1: Multi-source */}
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <polyline points="9 15 12 12 15 15"/>
                </svg>
              </div>
              <h3 className={styles.featureCardTitle}>Multi-Format Ingestion</h3>
              <p className={styles.featureCardText}>
                Accepts vendor website URLs, PDF catalogs, Word documents (DOCX), and Excel spreadsheets. Converts everything into standardized markdown using Microsoft MarkItDown.
              </p>
            </div>

            {/* Feature 2: Smart AI Extraction */}
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <h3 className={styles.featureCardTitle}>Structured AI Parsing</h3>
              <p className={styles.featureCardText}>
                Automatically extracts crucial details: titles, descriptions, SKUs, UPCs, prices, images, and technical specifications, converting values like "25KG" to structured database fields.
              </p>
            </div>

            {/* Feature 3: Variant Grouping */}
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </div>
              <h3 className={styles.featureCardTitle}>Smart Variant & Series Bundler</h3>
              <p className={styles.featureCardText}>
                Intelligently collapses variant codes (e.g., matching length and color attributes) into single Shopify products with multiple variants. Detects related products to group them as "Series".
              </p>
            </div>

            {/* Feature 4: Shopify Mapping */}
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <h3 className={styles.featureCardTitle}>Metafield & Collection Mapping</h3>
              <p className={styles.featureCardText}>
                Matches parsed attributes (e.g. Dimensions, Weight, Material) to your existing Shopify metafield definitions, and maps items to correct collections, creating new ones dynamically if needed.
              </p>
            </div>

          </div>
        </section>

        {/* Workflow Section */}
        <section id="workflow" className={styles.workflow}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>The Onboarding Pipeline</h2>
            <p className={styles.sectionSubtitle}>
              Four simple stages from raw catalog to live Shopify store listings.
            </p>
          </div>

          <div className={styles.pipeline}>
            <div className={styles.pipelineStep}>
              <div className={styles.stepNumber}>1</div>
              <h3 className={styles.stepTitle}>Ingest</h3>
              <p className={styles.stepText}>Provide a URL, crawl a category list, or drag and drop your PDFs and spreadsheets.</p>
            </div>
            <div className={styles.pipelineStep}>
              <div className={styles.stepNumber}>2</div>
              <h3 className={styles.stepTitle}>Extract</h3>
              <p className={styles.stepText}>Our parser combined with LLM fallbacks reads markdown text and identifies structured assets.</p>
            </div>
            <div className={styles.pipelineStep}>
              <div className={styles.stepNumber}>3</div>
              <h3 className={styles.stepTitle}>Review & Map</h3>
              <p className={styles.stepText}>Compare extracted values, assign metafield categories, check completeness scores, and resolve alerts.</p>
            </div>
            <div className={styles.pipelineStep}>
              <div className={styles.stepNumber}>4</div>
              <h3 className={styles.stepTitle}>Publish</h3>
              <p className={styles.stepText}>Click publish to push single products or bulk upload entire lines directly into Shopify.</p>
            </div>
          </div>
        </section>

        {/* FAQs Section */}
        <section id="faqs" className={styles.faqs}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
            <p className={styles.sectionSubtitle}>
              Everything you need to know about the Deskulpt Product AI Ingester.
            </p>
          </div>

          <div className={styles.accordionGroup}>
            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                What document formats can I ingest?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                We support PDF catalogs, Word documents (DOC/DOCX), Excel/spreadsheets, and raw HTML pages. All documents are normalized into Markdown using Microsoft MarkItDown for clean processing.
              </p>
            </details>

            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                How does vendor website crawling work?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                Simply enter a vendor's website URL. Our system checks sitemaps, robots.txt, and llms.txt, and parses structured schema.org markup (JSON-LD, microdata) to render a visual category tree of the website. You can then select specific categories to scrape in bulk.
              </p>
            </details>

            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                Do I need my own API keys to run the extraction?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                No, the built-in pattern-based parsing extracts attributes, SKUs, and variants with extreme speed (&lt;500ms) without any API keys. For complex or non-standard catalogs, you can toggle AI-assisted extraction in settings using your own Anthropic API key.
              </p>
            </details>

            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                Can it recognize variant tables in catalogs?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                Yes. The AI parser and pattern extractor are trained to recognize tabular variant options (like size, color, or voltage). It consolidates them and generates a bulk Shopify payload using productVariantsBulkCreate.
              </p>
            </details>

            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                How are specifications mapped to my Shopify store?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                The app analyzes your store's existing Metafield definitions. It then matches extracted technical specs (like 'Operating Voltage' or 'Material') to those definitions. If a definition doesn't exist, you can approve a proposal to create it directly from the review dashboard.
              </p>
            </details>

            <details className={styles.disclosure} name="faq-accordion">
              <summary className={styles.disclosureSummary}>
                What is the "Quote-Only" detection feature?
                <span className={styles.summaryIcon}>▼</span>
              </summary>
              <p className={styles.faqContent}>
                For B2B wholesalers, many items are not directly purchasable online. The app automatically detects terms in catalogs signifying "Call for price" or "RFQ", categorizes the product purchase type as quote-only, and maps this flag to a dedicated Shopify metafield.
              </p>
            </details>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLogo}>
          <div className={styles.footerIcon}>⚡</div>
          <span>Deskulpt Product AI Ingester</span>
        </div>
        <p className={styles.footerTech}>
          Powered by React Router, Shopify Polaris components, Microsoft MarkItDown parser, and Anthropic Claude 3.5 Sonnet.
        </p>
        <p className={styles.footerCopy}>
          &copy; {new Date().getFullYear()} Deskulpt. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
