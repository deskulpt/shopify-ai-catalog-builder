import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <AppProvider embedded apiKey={apiKey}>
        <style>{`
          :root {
            --pc-page-max-width: 100% !important;
          }
          body, html, main, #app, [data-polaris-layer] {
            max-width: 100% !important;
            width: 100% !important;
          }
          .Polaris-Page, 
          [class*="Polaris-Page"], 
          s-page, 
          [full-width],
          .Polaris-Box {
            max-width: 100% !important;
            width: 100% !important;
          }
          .Polaris-Page__Content {
            max-width: 100% !important;
            padding-left: 20px !important;
            padding-right: 20px !important;
          }
        `}</style>
        <s-app-nav>
          <s-link href="/app">Catalog Ingest</s-link>
          <s-link href="/app/settings">Settings</s-link>
          <s-link href="/app/help">Help & Docs</s-link>
          <s-link href="/app/help#support">Support</s-link>
        </s-app-nav>
        <Outlet />
      </AppProvider>
    </PolarisAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
