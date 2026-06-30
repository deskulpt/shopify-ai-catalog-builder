import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    const query = `
      query getMetafieldDefinitions {
        metafieldDefinitions(first: 100, ownerType: PRODUCT) {
          nodes {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }
    `;
    
    const response = await admin.graphql(query);
    const data = await response.json() as any;
    
    if (data.errors) {
      return Response.json({ error: data.errors.map((e: any) => e.message).join(", ") }, { status: 400 });
    }
    
    const definitions = data.data?.metafieldDefinitions?.nodes || [];
    return Response.json({ success: true, definitions });
  } catch (error: any) {
    return Response.json({ error: error.message || "Failed to load metafield definitions" }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { name, namespace = "custom", key, type = "single_line_text_field" } = body;

    if (!name || !key) {
      return Response.json({ error: "Name and Key are required to create a metafield definition" }, { status: 400 });
    }

    const mutation = `
      mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            name
            namespace
            key
            type {
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      definition: {
        name,
        namespace,
        key,
        ownerType: "PRODUCT",
        type,
      }
    };

    const res = await admin.graphql(mutation, { variables });
    const data = await res.json() as any;

    if (data.errors) {
      return Response.json({ error: data.errors.map((e: any) => e.message).join(", ") }, { status: 400 });
    }

    const result = data.data?.metafieldDefinitionCreate;
    if (result?.userErrors?.length) {
      return Response.json(
        { error: result.userErrors.map((e: any) => `${e.field.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }

    return Response.json({ success: true, definition: result.createdDefinition });
  } catch (error: any) {
    return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
};
