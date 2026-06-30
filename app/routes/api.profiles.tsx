import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const profiles = await prisma.crawlProfile.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ success: true, profiles });
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action, id, name, rootUrl, productPattern, categoryPattern } = body;

    if (action === "delete") {
      if (!id) {
        return Response.json({ success: false, error: "ID is required for deletion" }, { status: 400 });
      }
      await prisma.crawlProfile.delete({
        where: { id, shop },
      });
      return Response.json({ success: true });
    }

    // Create or Update
    if (!name || !rootUrl) {
      return Response.json({ success: false, error: "Name and Root URL are required" }, { status: 400 });
    }

    if (id) {
      // Update
      const updated = await prisma.crawlProfile.update({
        where: { id, shop },
        data: {
          name,
          rootUrl,
          productPattern: productPattern || "",
          categoryPattern: categoryPattern || "",
        },
      });
      return Response.json({ success: true, profile: updated });
    } else {
      // Create
      const created = await prisma.crawlProfile.create({
        data: {
          shop,
          name,
          rootUrl,
          productPattern: productPattern || "",
          categoryPattern: categoryPattern || "",
        },
      });
      return Response.json({ success: true, profile: created });
    }
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
};
