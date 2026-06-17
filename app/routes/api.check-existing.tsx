import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const { domain } = data;

    if (!domain) {
      return Response.json({ error: "Domain is required" }, { status: 400 });
    }

    let hasNextPage = true;
    let endCursor: string | null = null;
    const existingProducts: Record<string, { id: string; title: string; updatedAt: string }> = {};

    const query = `
      query getImportedProducts($cursor: String) {
        products(first: 250, after: $cursor, query: "tag:'Imported via AI Scraper'") {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            updatedAt
            originUrlMetafield: metafield(namespace: "$app", key: "origin_url") {
              value
            }
          }
        }
      }
    `;

    let pagesFetched = 0;
    while (hasNextPage && pagesFetched < 10) {
      pagesFetched++;
      const res: any = await admin.graphql(query, { variables: { cursor: endCursor } });
      const responseJson: any = await res.json();

      const products = responseJson.data?.products?.nodes || [];
      const pageInfo: any = responseJson.data?.products?.pageInfo;

      for (const product of products) {
        const originUrl = product.originUrlMetafield?.value;
        if (originUrl && originUrl.includes(domain)) {
          existingProducts[originUrl] = {
            id: product.id,
            title: product.title,
            updatedAt: product.updatedAt,
          };
        }
      }

      hasNextPage = pageInfo?.hasNextPage || false;
      endCursor = pageInfo?.endCursor || null;
    }

    return Response.json({ success: true, existingProducts });
  } catch (error: any) {
    return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
};
