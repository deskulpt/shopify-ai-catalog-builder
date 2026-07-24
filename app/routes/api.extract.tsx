import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
    const profileId = data.profileId;

    if (!markdown) {
      return Response.json({ error: "No Markdown provided" }, { status: 400 });
    }

    let extractionRules = undefined;
    if (profileId) {
      const profile = await prisma.crawlProfile.findUnique({
        where: { id: profileId },
      });
      if (profile && profile.extractionRules) {
        try {
          extractionRules = JSON.parse(profile.extractionRules);
        } catch (e) {}
      }
    } else if (domain || url) {
      const targetSearch = domain || (url ? new URL(url).hostname : "");
      if (targetSearch) {
        const profile = await prisma.crawlProfile.findFirst({
          where: {
            OR: [
              { rootUrl: { contains: targetSearch } },
              { name: { contains: targetSearch } }
            ]
          }
        });
        if (profile && profile.extractionRules) {
          try {
            extractionRules = JSON.parse(profile.extractionRules);
          } catch (e) {}
        }
      }
    }

    // Forward URL to Python extraction service
    const markitdownUrl = process.env.MARKITDOWN_SERVICE_URL || "http://localhost:5005";
    const response = await fetch(`${markitdownUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, domain, url, extraction_rules: extractionRules }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json(
        { error: errData.error || "Failed to extract product fields" },
        { status: response.status }
      );
    }

    const resData = await response.json();

    // Auto-heal or first-time generation of rules
    if (profileId && resData.extraction_rules) {
      await prisma.crawlProfile.update({
        where: { id: profileId },
        data: { extractionRules: JSON.stringify(resData.extraction_rules) },
      });
    }

    return Response.json(resData);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
};
