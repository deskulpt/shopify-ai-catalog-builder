import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Ping Python Flask service on port 5005
  let pythonServiceStatus = "offline";
  try {
    const response = await fetch("http://localhost:5005/health", { 
      signal: AbortSignal.timeout(2000) 
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === "ok") {
        pythonServiceStatus = "online";
      }
    }
  } catch (err) {
    // service offline
  }

  return {
    storeName: session.shop,
    pythonServiceStatus,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return null;
};

export default function Index() {
  const { storeName, pythonServiceStatus } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  return (
    <s-page heading="Product Ingest AI">
      <s-button 
        slot="primary-action" 
        onClick={() => shopify.toast.show("Next Phase: Ingestion UI & Crawl Tree!")}
      >
        Start Ingestion
      </s-button>

      <s-section heading="🎉 Welcome to Product Ingest AI Dashboard">
        <s-paragraph>
          This app is successfully installed on <strong>{storeName}</strong>. 
          It allows you to ingest vendor product websites, PDFs, DOC/DOCX, and raw URLs, converting them into structured Shopify draft products and variants.
        </s-paragraph>
        
        <s-stack direction="inline" gap="base" align="center" style={{ marginTop: "1rem" }}>
          <s-text><strong>Service Architecture Status:</strong></s-text>
          <s-box 
            padding="tight" 
            borderRadius="base" 
            background={pythonServiceStatus === "online" ? "success-subdued" : "critical-subdued"}
            style={{ display: "inline-block" }}
          >
            <s-text color={pythonServiceStatus === "online" ? "success" : "critical"}>
              ● Python MarkItDown Service: {pythonServiceStatus.toUpperCase()}
            </s-text>
          </s-box>
          <s-box 
            padding="tight" 
            borderRadius="base" 
            background="success-subdued"
            style={{ display: "inline-block" }}
          >
            <s-text color="success">
              ● Shopify API: CONNECTED
            </s-text>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="📋 Core Capabilities & Features">
        <s-stack direction="block" gap="loose">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>1. Vendor Website Discovery & Crawling</s-heading>
            <s-paragraph>
              Enter a vendor domain to discover sitemaps, `robots.txt`, `llms.txt`, and HTML `schema.org` taxonomy structures.
            </s-paragraph>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>2. Polaris Category Selection Tree</s-heading>
            <s-paragraph>
              Interactively select categories and products from the discovered site taxonomy tree before crawling and ingestion.
            </s-paragraph>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>3. Document & URL Markdown Parser</s-heading>
            <s-paragraph>
              Convert PDFs, DOC/DOCX, and HTML pages to clean Markdown via our dedicated Python microservice utilizing Microsoft MarkItDown.
            </s-paragraph>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>4. AI Extraction & Intelligent Variant Mapping</s-heading>
            <s-paragraph>
              Extract product titles, SKUs, images, descriptions, and normalize specifications. Group separate vendor SKU listings into a unified parent product with variants.
            </s-paragraph>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>5. Direct-Buy vs. Quote-Only Detection</s-heading>
            <s-paragraph>
              Automatically identify whether industrial products require a quote and map this using strict Shopify Metafield Definitions.
            </s-paragraph>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="System Specs & Resources">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">React Router v7</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link href="https://shopify.dev/docs/api/app-home/using-polaris-components" target="_blank">Polaris Web Components</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Custom Data: </s-text>
          <s-link href="https://shopify.dev/docs/apps/build/custom-data" target="_blank">Metafields &amp; Metaobjects</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Python Service: </s-text>
          <s-text>Port 5005 (MarkItDown + Flask)</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
