import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const {
      title,
      descriptionHtml,
      sku,
      purchase_type,
      currency,
      price_unit,
      vendor,
      specifications = [],
      metafieldMappings = {},
      variants = [],
      options = [],
      media_links = [],
      file_links = [],
      existingProductId,
      sourceUrl,
      sourceDomain,
      overwriteTitle = true,
      overwriteDescription = true,
      overwriteVariants = true,
      collections = [],
    } = data;

    if (!existingProductId && !title) {
      return Response.json({ error: "Product title is required" }, { status: 400 });
    }

    // Resolve relative URLs to absolute URLs using current tunnel origin
    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;
    const resolveRelativeUrl = (urlStr: string) => {
      if (urlStr && urlStr.startsWith("/")) {
        return `${origin}${urlStr}`;
      }
      return urlStr;
    };

    const resolvedMediaLinks = (media_links || []).map((m: any) => ({
      ...m,
      url: resolveRelativeUrl(m.url),
    }));

    const resolvedFileLinks = (file_links || []).map((f: any) => ({
      ...f,
      url: resolveRelativeUrl(f.url),
    }));

    // 1. Upload PDFs/Files to Shopify Files and get their Shopify CDN URLs
    const uploadedFiles: { url: string; text: string; embed?: boolean }[] = [];
    if (resolvedFileLinks && resolvedFileLinks.length > 0) {
      const filesInput = resolvedFileLinks.map((file: any) => ({
        originalSource: file.url,
        contentType: "FILE",
        alt: file.text || "Product Document",
      }));
      
      const fileCreateMutation = `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
              alt
              ... on GenericFile {
                url
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      try {
        const fileRes = await admin.graphql(fileCreateMutation, {
          variables: { files: filesInput },
        });
        const fileData = await fileRes.json();
        
        if (fileData.data?.fileCreate?.files) {
          let pendingFiles = fileData.data.fileCreate.files.map((f: any, idx: number) => ({
            id: f.id,
            status: f.fileStatus,
            url: f.url,
            originalUrl: resolvedFileLinks[idx].url,
            text: resolvedFileLinks[idx].text,
            embed: resolvedFileLinks[idx].embed,
          }));
          
          // Poll for URLs if they are not yet READY (up to 5 seconds)
          let attempts = 0;
          const maxAttempts = 5;
          while (attempts < maxAttempts && pendingFiles.some((f: any) => !f.url && f.status !== "FAILED")) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts++;
            
            const fileQuery = `
              query getFiles($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on GenericFile {
                    id
                    fileStatus
                    url
                  }
                }
              }
            `;
            
            const queryRes = await admin.graphql(fileQuery, {
              variables: { ids: pendingFiles.map((f: any) => f.id) },
            });
            const queryData = await queryRes.json();
            
            if (queryData.data?.nodes) {
              queryData.data.nodes.forEach((node: any) => {
                if (node) {
                  const match = pendingFiles.find((f: any) => f.id === node.id);
                  if (match) {
                    match.status = node.fileStatus;
                    match.url = node.url;
                  }
                }
              });
            }
          }
          
          pendingFiles.forEach((f: any) => {
            uploadedFiles.push({
              url: f.url || f.originalUrl,
              text: f.text,
              embed: f.embed,
            });
          });
        } else {
          resolvedFileLinks.forEach((f: any) => uploadedFiles.push(f));
        }
      } catch (err) {
        resolvedFileLinks.forEach((f: any) => uploadedFiles.push(f));
      }
    }

    // 1.1. Construct final description HTML appending selected specifications table
    let finalDescriptionHtml = descriptionHtml || "";
    if (specifications && specifications.length > 0) {
      const specTable = `
        <div class="product-specifications" style="margin-top: 20px;">
          <h3>Specifications</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #e1e3e5;">
            <tbody>
              ${specifications
                .map(
                  (spec: any, idx: number) => `
                <tr style="border-bottom: 1px solid #e1e3e5; ${
                  idx % 2 === 0 ? "background-color: #f6f6f7;" : ""
                }">
                  <td style="padding: 8px 12px; font-weight: 600; width: 40%;"><span style="font-size: 14px;">${
                    spec.name
                  }</span></td>
                  <td style="padding: 8px 12px;"><span style="font-size: 14px;">${
                    spec.value
                  }</span></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
      finalDescriptionHtml += specTable;
    }

    // 1.2. Append selected images (media_links)
    if (resolvedMediaLinks && resolvedMediaLinks.length > 0) {
      const mediaHtml = `
        <div class="product-media-gallery" style="margin-top: 20px;">
          <h3>Product Images</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
            ${resolvedMediaLinks
              .map(
                (media: any) => `
              <div style="border: 1px solid #e1e3e5; border-radius: 8px; padding: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 120px; background-color: #fafbfb;">
                <img src="${media.url}" alt="${media.alt || 'Product Image'}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
      finalDescriptionHtml += mediaHtml;
    }

    // 1.3. Append selected file links
    if (uploadedFiles && uploadedFiles.length > 0) {
      const filesHtml = `
        <div class="product-downloads" style="margin-top: 20px;">
          <h3>Downloads & Technical Files</h3>
          <ul style="list-style-type: none; padding-left: 0; margin-top: 8px;">
            ${uploadedFiles
              .map(
                (file: any) => `
              <li style="margin-bottom: 8px; display: flex; align-items: center;">
                <span style="font-size: 16px; margin-right: 8px;">📄</span>
                <a href="${file.url}" target="_blank" rel="noopener noreferrer" style="color: #008060; text-decoration: underline; font-weight: 500; font-size: 14px;">
                  ${file.text || 'Download File'}
                </a>
              </li>
            `
              )
              .join("")}
          </ul>
        </div>
      `;
      finalDescriptionHtml += filesHtml;
    }

    // 1.4. Append online interactive catalog iframe container
    const viewerFiles = (uploadedFiles || []).filter((file: any) => file.embed);
    if (viewerFiles.length > 0) {
      const viewerHtml = `
        <div class="product-interactive-catalogs" style="margin-top: 20px;">
          <h3>Interactive Catalog & Brochure</h3>
          ${viewerFiles
            .map(
              (file: any) => `
            <div style="margin-bottom: 15px; border: 1px solid #e1e3e5; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #f6f6f7; padding: 8px 12px; font-weight: 500; font-size: 14px; border-bottom: 1px solid #e1e3e5; display: flex; justify-content: space-between; align-items: center;">
                <span>${file.text || "Online Viewer"}</span>
                <a href="${file.url}" target="_blank" rel="noopener noreferrer" style="color: #008060; text-decoration: underline; font-size: 12px;">Open in New Tab ↗</a>
              </div>
              <div style="position: relative; width: 100%; height: 500px; -webkit-overflow-scrolling: touch; overflow: scroll;">
                <iframe src="${file.url}" width="100%" height="100%" style="border: none; position: absolute; top: 0; left: 0;" allowfullscreen></iframe>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      `;
      finalDescriptionHtml += viewerHtml;
    }

    const hasVariants = variants.length > 0 && options.length > 0;

    // 2. productCreate mutation variables
    const productInput: any = {
      tags: ["Imported via AI Scraper"],
    };

    if (!existingProductId || overwriteTitle) {
      productInput.title = title;
    }
    if (!existingProductId || overwriteDescription) {
      productInput.descriptionHtml = finalDescriptionHtml;
    }
    if (vendor) {
      productInput.vendor = vendor;
    }

    if (existingProductId) {
      productInput.id = existingProductId;
    } else {
      productInput.status = "DRAFT";
    }

    if (hasVariants && (!existingProductId || overwriteVariants)) {
      // Map options to OptionCreateInput
      productInput.productOptions = options.map((opt: any) => ({
        name: opt.name,
        values: opt.values.map((v: string) => ({ name: v })),
      }));
    }

    if (collections && collections.length > 0) {
      const validCollections = collections.filter((id: any) => typeof id === "string" && id.startsWith("gid://shopify/Collection/"));
      if (validCollections.length > 0) {
        productInput.collectionsToJoin = validCollections;
      }
    }

    const mutationName = existingProductId ? "productUpdate" : "productCreate";
    const productMutation = `
      mutation ${mutationName}($product: ${existingProductId ? "ProductInput!" : "ProductCreateInput!"}${existingProductId ? "" : ", $media: [CreateMediaInput!]"}) {
        ${mutationName}(product: $product${existingProductId ? "" : ", media: $media"}) {
          product {
            id
            title
            variants(first: 10) {
              nodes {
                id
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const mediaInput = resolvedMediaLinks.map((m: any) => ({
      originalSource: m.url,
      mediaContentType: "IMAGE",
      alt: m.alt || title,
    }));

    const createRes = await admin.graphql(productMutation, {
      variables: existingProductId 
        ? { product: productInput } 
        : { product: productInput, media: mediaInput },
    });
    const createData = await createRes.json() as any;

    if (createData.errors) {
      return Response.json(
        { error: createData.errors.map((e: any) => e.message).join(", ") },
        { status: 400 }
      );
    }

    const createResult = existingProductId ? createData.data?.productUpdate : createData.data?.productCreate;
    if (createResult?.userErrors?.length) {
      return Response.json(
        { error: createResult.userErrors.map((e: any) => `${e.field.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }

    const productId = createResult?.product?.id;
    if (!productId) {
      return Response.json({ error: "Failed to retrieve created product ID" }, { status: 500 });
    }

    // 3. Create or update variants
    if (!existingProductId || overwriteVariants) {
      if (hasVariants) {
        // Create custom variants in bulk
      const bulkVariantsInput = variants.map((v: any) => {
        const isQuote = purchase_type === "quote_only";
        const priceVal = isQuote ? "0.00" : (v.price ? String(v.price) : "0.00");
        
        return {
          optionValues: v.optionValues.map((ov: any) => ({
            optionName: ov.optionName,
            name: ov.name,
          })),
          price: priceVal,
          inventoryItem: {
            sku: v.sku || sku || "",
            tracked: !isQuote, // Disable inventory tracking for quote only items
          },
          inventoryPolicy: isQuote ? "CONTINUE" : "DENY",
        };
      });

      const variantsBulkCreateMutation = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const bulkRes = await admin.graphql(variantsBulkCreateMutation, {
        variables: {
          productId,
          variants: bulkVariantsInput,
        },
      });
      const bulkData = await bulkRes.json() as any;

      if (bulkData.errors) {
        return Response.json(
          { error: bulkData.errors.map((e: any) => e.message).join(", ") },
          { status: 400 }
        );
      }

      const bulkResult = bulkData.data?.productVariantsBulkCreate;
      if (bulkResult?.userErrors?.length) {
        return Response.json(
          { error: bulkResult.userErrors.map((e: any) => `${e.field.join(".")}: ${e.message}`).join(", ") },
          { status: 400 }
        );
      }
    } else {
      // Simple product: Update default variant with SKU, price, and inventory tracking settings
      const defaultVariantId = createResult?.product?.variants?.nodes?.[0]?.id;
      if (defaultVariantId) {
        const isQuote = purchase_type === "quote_only";
        const priceVal = isQuote ? "0.00" : (data.price ? String(data.price) : "0.00");

        const updateVariantInput = {
          id: defaultVariantId,
          price: priceVal,
          inventoryItem: {
            sku: sku || "",
            tracked: !isQuote,
          },
          inventoryPolicy: isQuote ? "CONTINUE" : "DENY",
        };

        const variantUpdateMutation = `
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              product {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const updateRes = await admin.graphql(variantUpdateMutation, {
          variables: {
            productId,
            variants: [updateVariantInput],
          },
        });
        const updateData = await updateRes.json() as any;

        if (updateData.errors) {
          return Response.json(
            { error: updateData.errors.map((e: any) => e.message).join(", ") },
            { status: 400 }
          );
        }

        const updateResult = updateData.data?.productVariantsBulkUpdate;
        if (updateResult?.userErrors?.length) {
          return Response.json(
            { error: updateResult.userErrors.map((e: any) => `${e.field.join(".")}: ${e.message}`).join(", ") },
            { status: 400 }
          );
        }
      }
    }
    }

    // 4. Set `$app.purchase_type` metafield
    const metafieldsSetMutation = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            key
            namespace
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const metafieldsVar = [
      {
        ownerId: productId,
        namespace: "$app",
        key: "purchase_type",
        type: "single_line_text_field",
        value: purchase_type || "direct_buy",
      },
    ];

    // Process custom specifications mappings to Shopify metafields
    if (specifications && specifications.length > 0 && metafieldMappings) {
      specifications.forEach((spec: any) => {
        const targetMetafield = metafieldMappings[spec.name];
        if (targetMetafield && targetMetafield !== "skip") {
          const parts = targetMetafield.split(".");
          if (parts.length === 2) {
            const [ns, ky] = parts;
            if (!metafieldsVar.some(m => m.namespace === ns && m.key === ky)) {
              metafieldsVar.push({
                ownerId: productId,
                namespace: ns,
                key: ky,
                type: "single_line_text_field",
                value: String(spec.value),
              });
            }
          }
        }
      });
    }

    if (sourceUrl) {
      metafieldsVar.push({
        ownerId: productId,
        namespace: "$app",
        key: "origin_url",
        type: "url",
        value: sourceUrl,
      });
    }

    if (sourceDomain) {
      metafieldsVar.push({
        ownerId: productId,
        namespace: "$app",
        key: "origin_domain",
        type: "single_line_text_field",
        value: sourceDomain,
      });
    }

    if (currency) {
      metafieldsVar.push({
        ownerId: productId,
        namespace: "$app",
        key: "price_currency",
        type: "single_line_text_field",
        value: currency,
      });
    }

    if (price_unit && price_unit.trim()) {
      metafieldsVar.push({
        ownerId: productId,
        namespace: "$app",
        key: "price_unit",
        type: "single_line_text_field",
        value: price_unit.trim(),
      });
    }

    const metafieldsRes = await admin.graphql(metafieldsSetMutation, {
      variables: { metafields: metafieldsVar },
    });
    const metafieldsData = await metafieldsRes.json() as any;

    if (metafieldsData.errors) {
      return Response.json(
        { error: metafieldsData.errors.map((e: any) => e.message).join(", ") },
        { status: 400 }
      );
    }

    const metafieldsResult = metafieldsData.data?.metafieldsSet;
    if (metafieldsResult?.userErrors?.length) {
      return Response.json(
        { error: metafieldsResult.userErrors.map((e: any) => `${e.field.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }

    return Response.json({ success: true, productId });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
};
