import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const url = data.url;

    if (!url) {
      return Response.json({ error: "No URL provided" }, { status: 400 });
    }

    // Forward URL to Python MarkItDown service
    const response = await fetch("http://localhost:5005/convert-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json(
        { error: errData.error || "Failed to convert URL" },
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
