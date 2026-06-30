import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Forward file to Python MarkItDown service
    const targetFormData = new FormData();
    targetFormData.append("file", file);

    const markitdownUrl = process.env.MARKITDOWN_SERVICE_URL || "http://localhost:5005";
    const response = await fetch(`${markitdownUrl}/convert`, {
      method: "POST",
      body: targetFormData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json(
        { error: errData.error || "Failed to convert file" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
};
