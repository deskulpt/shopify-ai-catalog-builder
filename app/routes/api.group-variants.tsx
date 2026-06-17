import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const products = data.products;
    const collections = data.collections || [];

    if (!products || !Array.isArray(products)) {
      return Response.json({ error: "Invalid or missing products array" }, { status: 400 });
    }

    // Forward to Python group-variants service
    const response = await fetch("http://localhost:5005/group-variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products, collections }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json(
        { error: errData.error || "Failed to group product variants" },
        { status: response.status }
      );
    }

    const resData = await response.json();
    return Response.json(resData);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
};
