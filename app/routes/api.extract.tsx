import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const markdown = data.markdown;
    const domain = data.domain;
    const url = data.url;

    if (!markdown) {
      return Response.json({ error: "No Markdown provided" }, { status: 400 });
    }

    // Forward URL to Python extraction service
    const response = await fetch("http://localhost:5005/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, domain, url }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json(
        { error: errData.error || "Failed to extract product fields" },
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
