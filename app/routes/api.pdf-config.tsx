import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);

/**
 * /api/pdf-config
 *
 * Proxies PDF extraction configuration to the Python backend service.
 *
 * GET: Retrieves current configuration
 * PUT: Updates configuration (including API keys)
 */

const MARKITDOWN_SERVICE_URL = process.env.MARKITDOWN_SERVICE_URL || "http://localhost:5005";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const response = await fetch(`${MARKITDOWN_SERVICE_URL}/pdf-config`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return json(
        { error: `Backend returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return json(data);
  } catch (error) {
    console.error("[api.pdf-config] GET error:", error);
    return json({ error: String(error) }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "PUT") {
    try {
      const body = await request.json();

      const response = await fetch(`${MARKITDOWN_SERVICE_URL}/pdf-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return json(
          { error: `Backend returned ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      return json(data);
    } catch (error) {
      console.error("[api.pdf-config] PUT error:", error);
      return json({ error: String(error) }, { status: 500 });
    }
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}
