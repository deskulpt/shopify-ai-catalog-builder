import { loader as metafieldsLoader, action as metafieldsAction } from "../app/routes/api.metafields";
import { action as publishAction } from "../app/routes/api.publish";
import { setMockAuthenticate } from "../app/shopify.server";

// Mock response helpers
const createMockAdmin = (graphqlMock: any) => ({
  graphql: graphqlMock,
});

async function runTests() {
  console.log("🚀 Starting E2E Route Integration Tests...\n");

  // ==========================================
  // Test 1: GET /api/metafields Loader
  // ==========================================
  console.log("🔹 Test 1: GET /api/metafields - Loader");
  
  const mockDefinitions = [
    { id: "gid://shopify/MetafieldDefinition/1", name: "Material", namespace: "custom", key: "material", type: { name: "single_line_text_field" } },
    { id: "gid://shopify/MetafieldDefinition/2", name: "Color", namespace: "custom", key: "color", type: { name: "single_line_text_field" } }
  ];

  const graphqlMock1 = async () => {
    return {
      json: async () => ({
        data: {
          metafieldDefinitions: {
            nodes: mockDefinitions
          }
        }
      })
    };
  };

  setMockAuthenticate(() => ({ admin: createMockAdmin(graphqlMock1) }));

  const mockRequest1 = new Request("http://localhost:3000/api/metafields");
  const response1 = await metafieldsLoader({ request: mockRequest1, params: {} } as any);
  const data1 = await response1.json() as any;

  if (data1.success && data1.definitions.length === 2) {
    console.log("✅ Test 1 Passed! Metafield definitions loaded successfully.");
  } else {
    throw new Error(`❌ Test 1 Failed: ${JSON.stringify(data1)}`);
  }

  // ==========================================
  // Test 2: POST /api/metafields Action (Create)
  // ==========================================
  console.log("\n🔹 Test 2: POST /api/metafields - Action (Create Definition)");

  const newDef = {
    id: "gid://shopify/MetafieldDefinition/3",
    name: "Cap Size",
    namespace: "custom",
    key: "cap_size",
    type: { name: "single_line_text_field" }
  };

  const graphqlMock2 = async () => {
    return {
      json: async () => ({
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: newDef,
            userErrors: []
          }
        }
      })
    };
  };

  setMockAuthenticate(() => ({ admin: createMockAdmin(graphqlMock2) }));

  const mockRequest2 = new Request("http://localhost:3000/api/metafields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Cap Size",
      key: "cap_size"
    })
  });

  const response2 = await metafieldsAction({ request: mockRequest2, params: {} } as any);
  const data2 = await response2.json() as any;

  if (data2.success && data2.definition.name === "Cap Size" && data2.definition.key === "cap_size") {
    console.log("✅ Test 2 Passed! Metafield definition created successfully.");
  } else {
    throw new Error(`❌ Test 2 Failed: ${JSON.stringify(data2)}`);
  }

  // ==========================================
  // Test 3: POST /api/publish Action (Mapping Specs to Metafields)
  // ==========================================
  console.log("\n🔹 Test 3: POST /api/publish - Action (Map specs and verify skips)");

  let metafieldsSetCallPayload: any = null;

  const graphqlMock3 = async (query: string, options: any) => {
    // Intercept metafieldsSet mutation
    if (query.includes("mutation MetafieldsSet")) {
      metafieldsSetCallPayload = options.variables.metafields;
      return {
        json: async () => ({
          data: {
            metafieldsSet: {
              metafields: metafieldsSetCallPayload,
              userErrors: []
            }
          }
        })
      };
    }
    
    // Fallback for product creation
    if (query.includes("mutation productCreate")) {
      return {
        json: async () => ({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/123456",
                variants: { nodes: [{ id: "gid://shopify/ProductVariant/789" }] }
              },
              userErrors: []
            }
          }
        })
      };
    }

    // Fallback for variant bulk update
    if (query.includes("mutation productVariantsBulkUpdate")) {
      return {
        json: async () => ({
          data: {
            productVariantsBulkUpdate: {
              product: { id: "gid://shopify/Product/123456" },
              userErrors: []
            }
          }
        })
      };
    }

    return { json: async () => ({ data: {} }) };
  };

  setMockAuthenticate(() => ({ admin: createMockAdmin(graphqlMock3) }));

  const publishPayload = {
    title: "Test Ingest Product",
    sku: "TEST-SKU",
    purchase_type: "direct_buy",
    specifications: [
      { name: "Material", value: "Alloy Steel" },
      { name: "Dimensions", value: "5x5x10 cm" },
      { name: "Excluded Attr", value: "Some Value" }
    ],
    metafieldMappings: {
      "Material": "custom.material",
      "Dimensions": "custom.dimensions",
      "Excluded Attr": "skip" // This must be ignored
    }
  };

  const mockRequest3 = new Request("http://localhost:3000/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publishPayload)
  });

  const response3 = await publishAction({ request: mockRequest3, params: {} } as any);
  const data3 = await response3.json() as any;

  if (data3.success && data3.productId === "gid://shopify/Product/123456") {
    // Assert metafields set payload format and exclusions
    if (!metafieldsSetCallPayload) {
      throw new Error("❌ Test 3 Failed: MetafieldsSet mutation was not called.");
    }
    
    const materialMetafield = metafieldsSetCallPayload.find((m: any) => m.key === "material");
    const dimensionsMetafield = metafieldsSetCallPayload.find((m: any) => m.key === "dimensions");
    const excludedMetafield = metafieldsSetCallPayload.find((m: any) => m.key === "excluded_attr");

    if (!materialMetafield || materialMetafield.value !== "Alloy Steel") {
      throw new Error(`❌ Test 3 Failed: Material metafield missing or incorrect value: ${JSON.stringify(materialMetafield)}`);
    }

    if (!dimensionsMetafield || dimensionsMetafield.value !== "5x5x10 cm") {
      throw new Error(`❌ Test 3 Failed: Dimensions metafield missing or incorrect value: ${JSON.stringify(dimensionsMetafield)}`);
    }

    if (excludedMetafield) {
      throw new Error("❌ Test 3 Failed: Excluded attribute was not skipped!");
    }

    console.log("✅ Test 3 Passed! Metafield mappings applied and skipped attributes successfully ignored.");
  } else {
    throw new Error(`❌ Test 3 Failed publishing product: ${JSON.stringify(data3)}`);
  }

  console.log("\n🎉 All Route E2E Integration Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("\n❌ Route Integration Tests Failed:");
  console.error(err);
  process.exit(1);
});
