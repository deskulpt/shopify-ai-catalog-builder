import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const collectionsQuery = `
    query getCollections($cursor: String) {
      collections(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          productsCount {
            count
          }
          image {
            url
            altText
          }
        }
      }
    }
  `;

  try {
    const allCollections: any[] = [];
    let cursor: string | null = null;

    // Paginate through all collections (up to 1000)
    for (let page = 0; page < 4; page++) {
      const res: any = await admin.graphql(collectionsQuery, {
        variables: { cursor },
      });
      const data = await res.json();
      const collData = data.data?.collections;
      if (!collData) break;

      allCollections.push(
        ...collData.nodes.map((c: any) => ({
          id: c.id,
          title: c.title,
          handle: c.handle,
          productsCount: c.productsCount?.count ?? 0,
          imageUrl: c.image?.url ?? null,
        }))
      );

      if (!collData.pageInfo?.hasNextPage) break;
      cursor = collData.pageInfo.endCursor;
    }

    return Response.json({ success: true, collections: allCollections });
  } catch (err: any) {
    return Response.json(
      { success: false, error: err.message || "Failed to fetch collections" },
      { status: 500 }
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json();
    const { title } = data;

    if (!title) {
      return Response.json({ success: false, error: "Title is required to create a collection" }, { status: 400 });
    }

    const mutation = `
      mutation collectionCreate($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const res: any = await admin.graphql(mutation, {
      variables: {
        input: {
          title,
        },
      },
    });

    const responseData = await res.json();
    const collectionCreate = responseData.data?.collectionCreate;

    if (collectionCreate?.userErrors?.length > 0) {
      return Response.json({ success: false, error: collectionCreate.userErrors[0].message }, { status: 400 });
    }

    const newCollection = collectionCreate?.collection;

    if (!newCollection) {
      return Response.json({ success: false, error: "Failed to create collection - no data returned" }, { status: 500 });
    }

    return Response.json({ success: true, collection: newCollection });

  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Internal server error" }, { status: 500 });
  }
};
