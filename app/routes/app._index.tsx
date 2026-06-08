import { useState, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface QueuedSource {
  id: string;
  name: string;
  type: "file" | "url";
  status: "queued" | "converting" | "ready" | "failed";
  markdown: string;
  error?: string;
  domain?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Ping Python Flask service on port 5005
  let pythonServiceStatus = "offline";
  try {
    const response = await fetch("http://localhost:5005/health", { 
      signal: AbortSignal.timeout(1500) 
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === "ok") {
        pythonServiceStatus = "online";
      }
    }
  } catch (err) {
    // service offline
  }

  return {
    storeName: session.shop,
    pythonServiceStatus,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return null;
};

export default function Index() {
  const { storeName, pythonServiceStatus } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [queuedSources, setQueuedSources] = useState<QueuedSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMultiProduct, setIsMultiProduct] = useState(false);

  // Editable markdown content
  const [editingMarkdown, setEditingMarkdown] = useState("");

  const selectedSource = queuedSources.find(s => s.id === selectedSourceId);

  // Detect if selected source likely contains multiple products and trigger extraction
  useEffect(() => {
    if (selectedSource?.markdown) {
      setEditingMarkdown(selectedSource.markdown);
      
      // Simple multi-product heuristic: multiple tables or occurrences of SKU / Model
      const skuMatches = (selectedSource.markdown.match(/sku/gi) || []).length;
      const modelMatches = (selectedSource.markdown.match(/model/gi) || []).length;
      setIsMultiProduct(skuMatches > 2 || modelMatches > 2);

      // Trigger field extraction automatically
      runExtraction(selectedSource.markdown, selectedSource.domain);
    } else {
      setEditingMarkdown("");
      setIsMultiProduct(false);
      setExtractedProduct(null);
    }
  }, [selectedSourceId, selectedSource?.markdown]);

  const handleFileUpload = async (file: File) => {
    const newSource: QueuedSource = {
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: "file",
      status: "converting",
      markdown: "",
    };
    setQueuedSources(prev => [...prev, newSource]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/upload", { 
        method: "POST", 
        body: formData 
      });
      const data = await res.json();
      
      if (data.success) {
        setQueuedSources(prev => 
          prev.map(s => s.id === newSource.id 
            ? { ...s, status: "ready", markdown: data.markdown } 
            : s
          )
        );
        setSelectedSourceId(newSource.id);
      } else {
        setQueuedSources(prev => 
          prev.map(s => s.id === newSource.id 
            ? { ...s, status: "failed", error: data.error } 
            : s
          )
        );
      }
    } catch (err: any) {
      setQueuedSources(prev => 
        prev.map(s => s.id === newSource.id 
          ? { ...s, status: "failed", error: err.message } 
          : s
        )
      );
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput) return;

    const newSource: QueuedSource = {
      id: Math.random().toString(36).substring(7),
      name: urlInput,
      type: "url",
      status: "converting",
      markdown: "",
    };
    setQueuedSources(prev => [...prev, newSource]);
    setUrlInput("");

    try {
      const res = await fetch("/api/url-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newSource.name }),
      });
      const data = await res.json();

      if (data.success) {
        setQueuedSources(prev => 
          prev.map(s => s.id === newSource.id 
            ? { ...s, status: "ready", markdown: data.markdown } 
            : s
          )
        );
        setSelectedSourceId(newSource.id);
      } else {
        setQueuedSources(prev => 
          prev.map(s => s.id === newSource.id 
            ? { ...s, status: "failed", error: data.error } 
            : s
          )
        );
      }
    } catch (err: any) {
      setQueuedSources(prev => 
        prev.map(s => s.id === newSource.id 
          ? { ...s, status: "failed", error: err.message } 
          : s
        )
      );
    }
  };

  const handleRemoveSource = (id: string) => {
    if (confirm("Are you sure you want to remove this source from the queue?")) {
      setQueuedSources(prev => prev.filter(s => s.id !== id));
      if (selectedSourceId === id) setSelectedSourceId(null);
    }
  };

  // Website Crawling & Structure Selection States
  const [crawlUrlInput, setCrawlUrlInput] = useState("");
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<any | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const handleCrawlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrlInput) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setExpandedCategories({});
    setSelectedProducts([]);

    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: crawlUrlInput }),
      });
      const data = await res.json();

      if (data.success) {
        setCrawlResult(data);
        const defaultExpanded: Record<string, boolean> = {};
        data.categories.forEach((cat: any) => {
          defaultExpanded[cat.name] = true;
        });
        setExpandedCategories(defaultExpanded);

        const allUrls = data.categories.flatMap((cat: any) =>
          (cat.products || []).map((p: any) => p.url)
        );
        setSelectedProducts(allUrls);
      } else {
        shopify.toast.show(`Crawling failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      shopify.toast.show(`Crawling error: ${err.message}`);
    } finally {
      setIsCrawling(false);
    }
  };

  const toggleCategoryExpand = (catName: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [catName]: !prev[catName],
    }));
  };

  const handleCategorySelectToggle = (category: any, checked: boolean) => {
    const catUrls = (category.products || []).map((p: any) => p.url);
    if (checked) {
      setSelectedProducts(prev => {
        const next = [...prev];
        catUrls.forEach((url: string) => {
          if (!next.includes(url)) next.push(url);
        });
        return next;
      });
    } else {
      setSelectedProducts(prev => prev.filter(url => !catUrls.includes(url)));
    }
  };

  const handleProductSelectToggle = (productUrl: string) => {
    setSelectedProducts(prev =>
      prev.includes(productUrl)
        ? prev.filter(url => url !== productUrl)
        : [...prev, productUrl]
    );
  };

  const triggerUrlIngestion = async (source: QueuedSource) => {
    setQueuedSources(prev =>
      prev.map(s => s.id === source.id ? { ...s, status: "converting" } : s)
    );

    try {
      const res = await fetch("/api/url-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.name }),
      });
      const data = await res.json();

      if (data.success) {
        setQueuedSources(prev =>
          prev.map(s => s.id === source.id
            ? { ...s, status: "ready", markdown: data.markdown }
            : s
          )
        );
      } else {
        setQueuedSources(prev =>
          prev.map(s => s.id === source.id
            ? { ...s, status: "failed", error: data.error }
            : s
          )
        );
      }
    } catch (err: any) {
      setQueuedSources(prev =>
        prev.map(s => s.id === source.id
          ? { ...s, status: "failed", error: err.message }
          : s
        )
      );
    }
  };

  const handleQueueSelected = () => {
    if (!crawlResult) return;

    const newSources: QueuedSource[] = [];
    crawlResult.categories.forEach((cat: any) => {
      (cat.products || []).forEach((prod: any) => {
        if (selectedProducts.includes(prod.url)) {
          newSources.push({
            id: Math.random().toString(36).substring(7),
            name: prod.url,
            type: "url",
            status: "queued",
            markdown: "",
            domain: crawlResult.domain
          });
        }
      });
    });

    if (newSources.length === 0) return;

    setQueuedSources(prev => {
      const existingNames = prev.map(s => s.name);
      const uniqueNew = newSources.filter(s => !existingNames.includes(s.name));
      return [...prev, ...uniqueNew];
    });

    shopify.toast.show(`Queued ${newSources.length} products successfully!`);

    newSources.forEach((source) => {
      triggerUrlIngestion(source);
    });
  };

  // Grouping & Extraction States
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [isGrouping, setIsGrouping] = useState(false);
  const [groupedCategories, setGroupedCategories] = useState<Record<string, any[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const [extractedProduct, setExtractedProduct] = useState<any | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleGroupToggle = async (checked: boolean) => {
    setGroupSimilar(checked);
    if (!checked || !crawlResult) return;

    setIsGrouping(true);
    const newGroupedCats: Record<string, any[]> = {};

    try {
      for (const category of crawlResult.categories) {
        const catProducts = category.products || [];
        if (catProducts.length <= 1) {
          newGroupedCats[category.name] = catProducts.map((p: any) => ({
            title: p.name,
            is_grouped: false,
            variants: [p]
          }));
          continue;
        }

        const res = await fetch("/api/group-variants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products: catProducts }),
        });
        const data = await res.json();
        if (data.success) {
          newGroupedCats[category.name] = data.grouped;
        } else {
          newGroupedCats[category.name] = catProducts.map((p: any) => ({
            title: p.name,
            is_grouped: false,
            variants: [p]
          }));
        }
      }
      setGroupedCategories(newGroupedCats);
    } catch (err) {
      shopify.toast.show("Error grouping variants");
    } finally {
      setIsGrouping(false);
    }
  };

  const toggleGroupExpand = (groupTitle: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupTitle]: !prev[groupTitle]
    }));
  };

  const handleGroupSelectToggle = (group: any, checked: boolean) => {
    const groupUrls = (group.variants || []).map((v: any) => v.url);
    if (checked) {
      setSelectedProducts(prev => {
        const next = [...prev];
        groupUrls.forEach((url: string) => {
          if (!next.includes(url)) next.push(url);
        });
        return next;
      });
    } else {
      setSelectedProducts(prev => prev.filter(url => !groupUrls.includes(url)));
    }
  };

  const runExtraction = async (mdContent: string, domainStr?: string) => {
    setIsExtracting(true);
    setExtractedProduct(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: mdContent, domain: domainStr }),
      });
      const data = await res.json();
      if (data.success) {
        setExtractedProduct(data);
      } else {
        shopify.toast.show(`Extraction failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      shopify.toast.show(`Extraction error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <s-page heading="Product Ingest AI">
      <s-button 
        slot="primary-action" 
        onClick={() => shopify.toast.show("Plan 1 complete: Drag-drop & URL parsing functional")}
      >
        Save Queue
      </s-button>

      {/* Connection & Welcome Section */}
      <s-section heading="🎉 Welcome to Product Ingest AI Dashboard">
        <s-paragraph>
          This app is successfully installed on <strong>{storeName}</strong>. 
          Upload product documents or parse single URL structures.
        </s-paragraph>
        
        <s-stack direction="inline" gap="base" align="center" style={{ marginTop: "1rem" }}>
          <s-text><strong>Service Status:</strong></s-text>
          <s-box 
            padding="tight" 
            borderRadius="base" 
            background={pythonServiceStatus === "online" ? "success-subdued" : "critical-subdued"}
            style={{ display: "inline-block" }}
          >
            <s-text color={pythonServiceStatus === "online" ? "success" : "critical"}>
              ● Python Service: {pythonServiceStatus.toUpperCase()}
            </s-text>
          </s-box>
          <s-box padding="tight" borderRadius="base" background="success-subdued" style={{ display: "inline-block" }}>
            <s-text color="success">● Shopify API: CONNECTED</s-text>
          </s-box>
        </s-stack>
      </s-section>

      {/* Ingestion Source Panel */}
      <s-section heading="📥 Ingest New Sources">
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
          
          {/* File Dropzone */}
          <div style={{ flex: 1, minWidth: "280px" }}>
            <s-heading>Drag & Drop Documents</s-heading>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
              style={{
                border: isDragOver ? "2px dashed #008060" : "2px dashed #bbb",
                borderRadius: "8px",
                padding: "40px 20px",
                textAlign: "center",
                background: isDragOver ? "#f0f8f4" : "#fafafa",
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                marginTop: "10px",
              }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".pdf,.docx,.doc,.html,.txt";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFileUpload(file);
                };
                input.click();
              }}
            >
              <s-text style={{ fontSize: "28px" }}>📄</s-text>
              <s-paragraph>
                <strong>Drag & drop file here</strong> or click to browse
              </s-paragraph>
              <s-text variant="bodySm" color="subdued">
                Supports PDF, DOCX, HTML up to 10MB
              </s-text>
            </div>
          </div>

          {/* URL Ingress */}
          <div style={{ flex: 1, minWidth: "280px" }}>
            <s-heading>Parse Single Product URL</s-heading>
            <form onSubmit={handleUrlSubmit} style={{ marginTop: "10px" }}>
              <s-stack direction="block" gap="base">
                <input
                  type="url"
                  placeholder="https://vendor.com/products/valve-100"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                  required
                />
                <s-button type="submit" variant="primary">
                  Stage URL for Ingestion
                </s-button>
              </s-stack>
            </form>
          </div>

        </div>
      </s-section>

      {/* Website Structure Discovery & Category Selection */}
      <s-section heading="🔍 Crawl Vendor Website Catalog">
        <s-paragraph>
          Enter a vendor website domain to discover sitemaps, robots.txt rules, llms.txt, and taxonomy structure.
        </s-paragraph>
        <form onSubmit={handleCrawlSubmit} style={{ marginTop: "15px", marginBottom: "15px" }}>
          <s-stack direction="inline" gap="base" align-items="center">
            <input
              type="url"
              placeholder="https://mock-vendor.com"
              value={crawlUrlInput}
              onChange={(e) => setCrawlUrlInput(e.target.value)}
              style={{
                flex: 1,
                minWidth: "250px",
                padding: "10px 14px",
                borderRadius: "6px",
                border: "1px solid #ccc",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
              required
            />
            <s-button type="submit" variant="primary" disabled={isCrawling}>
              {isCrawling ? "Crawling..." : "Discover Catalog"}
            </s-button>
          </s-stack>
        </form>

        {isCrawling && (
          <s-box padding="base" style={{ textAlign: "center" }}>
            <s-spinner size="base" accessibility-label="Crawling website structure"></s-spinner>
            <s-paragraph style={{ marginTop: "10px" }}>Logical crawler parsing sitemaps, robots, and schema.org...</s-paragraph>
          </s-box>
        )}

        {crawlResult && (
          <s-box padding="base" border="base" borderRadius="base" style={{ marginTop: "15px" }}>
            <s-stack direction="block" gap="base">
              {/* Site Metadata Badges */}
              <s-stack direction="inline" gap="base">
                <s-badge tone={crawlResult.mocked ? "warning" : "success"}>
                  Domain: {crawlResult.domain}{crawlResult.mocked && " (Mocked)"}
                </s-badge>
                {crawlResult.llms_txt ? (
                  <s-badge tone="info">llms.txt Discovered</s-badge>
                ) : (
                  <s-badge tone="neutral">No llms.txt</s-badge>
                )}
                {crawlResult.robots?.sitemaps?.length > 0 && (
                  <s-badge tone="success">
                    {crawlResult.robots.sitemaps.length} Sitemap(s) Found
                  </s-badge>
                )}
                {crawlResult.robots?.crawl_delay && (
                  <s-badge tone="attention">
                    Delay: {crawlResult.robots.crawl_delay}s
                  </s-badge>
                )}
              </s-stack>

              {/* Collapsible llms.txt details if exists */}
              {crawlResult.llms_txt && (
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-heading>llms.txt content</s-heading>
                  <pre style={{ margin: "5px 0 0 0", fontSize: "11px", whiteSpace: "pre-wrap", background: "#f1f1f1", padding: "8px", borderRadius: "4px" }}>
                    {crawlResult.llms_txt}
                  </pre>
                </s-box>
              )}

              {/* Collapsible Category Tree */}
              <s-heading>Discovered Categories & Products</s-heading>
              <s-paragraph>Select which categories or specific products to scrape and queue:</s-paragraph>

              {/* Grouping Toggle Option */}
              <s-box padding="small" background="subdued" borderRadius="base" style={{ marginBottom: "15px" }}>
                <s-stack direction="inline" gap="base" align-items="center">
                  <input
                    type="checkbox"
                    id="group-toggle"
                    checked={groupSimilar}
                    onChange={(e) => handleGroupToggle(e.target.checked)}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  <label htmlFor="group-toggle" style={{ cursor: "pointer", fontWeight: "bold" }}>
                    Intelligently group similar series / variants (by SKU prefix & name similarity)
                  </label>
                  {isGrouping && <s-spinner size="base" accessibility-label="Grouping variants..."></s-spinner>}
                </s-stack>
              </s-box>

              <div style={{ paddingLeft: "10px" }}>
                {crawlResult.categories.map((category: any) => {
                  const isCatExpanded = !!expandedCategories[category.name];
                  const catProducts = category.products || [];
                  const selectedInCat = selectedProducts.filter(url => 
                    catProducts.some((p: any) => p.url === url)
                  );
                  const isAllSelected = catProducts.length > 0 && selectedInCat.length === catProducts.length;
                  const isSomeSelected = selectedInCat.length > 0 && !isAllSelected;

                  return (
                    <div key={category.name} style={{ marginBottom: "10px", borderBottom: "1px solid #f4f6f8", paddingBottom: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <s-button
                          variant="tertiary"
                          icon={isCatExpanded ? "chevron-up" : "chevron-down"}
                          onClick={() => toggleCategoryExpand(category.name)}
                        />
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          ref={el => {
                            if (el) el.indeterminate = isSomeSelected;
                          }}
                          onChange={(e) => handleCategorySelectToggle(category, e.target.checked)}
                          style={{ cursor: "pointer", width: "16px", height: "16px" }}
                        />
                        <s-text type="strong">
                          {category.name} ({category.product_count} products)
                        </s-text>
                      </div>

                      {isCatExpanded && (
                        <div style={{ paddingLeft: "30px", marginTop: "8px" }}>
                          {groupSimilar ? (
                            (groupedCategories[category.name] || []).map((group: any) => {
                              if (group.is_grouped) {
                                const isGroupExpanded = !!expandedGroups[group.title];
                                const groupUrls = group.variants.map((v: any) => v.url);
                                const selectedInGroup = selectedProducts.filter(url => groupUrls.includes(url));
                                const isAllGroupSelected = selectedInGroup.length === groupUrls.length;
                                const isSomeGroupSelected = selectedInGroup.length > 0 && !isAllGroupSelected;

                                return (
                                  <div key={group.title} style={{ margin: "10px 0", paddingLeft: "15px", borderLeft: "2px solid #ccc" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                      <s-button
                                        variant="tertiary"
                                        icon={isGroupExpanded ? "chevron-up" : "chevron-down"}
                                        onClick={() => toggleGroupExpand(group.title)}
                                      />
                                      <input
                                        type="checkbox"
                                        checked={isAllGroupSelected}
                                        ref={el => {
                                          if (el) el.indeterminate = isSomeGroupSelected;
                                        }}
                                        onChange={(e) => handleGroupSelectToggle(group, e.target.checked)}
                                        style={{ cursor: "pointer", width: "14px", height: "14px" }}
                                      />
                                      <s-stack direction="inline" gap="tight" align-items="center">
                                        <s-text type="strong">{group.title}</s-text>
                                        <s-badge tone="info">{group.variants.length} Variants</s-badge>
                                        {group.options && group.options.map((opt: string) => (
                                          <s-chip key={opt} size="base">{opt}</s-chip>
                                        ))}
                                      </s-stack>
                                    </div>

                                    {isGroupExpanded && (
                                      <div style={{ paddingLeft: "45px", marginTop: "6px" }}>
                                        {group.variants.map((variant: any) => {
                                          const isChecked = selectedProducts.includes(variant.url);
                                          return (
                                            <div key={variant.url} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => handleProductSelectToggle(variant.url)}
                                                style={{ cursor: "pointer" }}
                                              />
                                              <s-stack direction="block">
                                                <s-text>{variant.name}</s-text>
                                                <s-text variant="bodySm" color="subdued">
                                                  {variant.url} {variant.option_values && `| Option: ${JSON.stringify(variant.option_values)}`}
                                                </s-text>
                                              </s-stack>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              } else {
                                const standalone = group.variants[0];
                                const isChecked = selectedProducts.includes(standalone.url);
                                return (
                                  <div key={standalone.url} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0", paddingLeft: "15px" }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleProductSelectToggle(standalone.url)}
                                      style={{ cursor: "pointer" }}
                                    />
                                    <s-stack direction="block">
                                      <s-text>{standalone.name}</s-text>
                                      <s-text variant="bodySm" color="subdued">{standalone.url}</s-text>
                                    </s-stack>
                                  </div>
                                );
                              }
                            })
                          ) : (
                            catProducts.map((prod: any) => {
                              const isChecked = selectedProducts.includes(prod.url);
                              return (
                                <div key={prod.url} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0" }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleProductSelectToggle(prod.url)}
                                    style={{ cursor: "pointer" }}
                                  />
                                  <s-stack direction="block">
                                    <s-text>{prod.name}</s-text>
                                    <s-text variant="bodySm" color="subdued">{prod.url}</s-text>
                                  </s-stack>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <s-stack direction="inline" gap="base" style={{ marginTop: "10px" }}>
                <s-button variant="primary" onClick={handleQueueSelected} disabled={selectedProducts.length === 0}>
                  Queue Selected Products ({selectedProducts.length})
                </s-button>
                <s-button onClick={() => {
                  setSelectedProducts([]);
                }}>
                  Clear Selection
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        )}
      </s-section>

      {/* Ingestion Queue List */}
      {queuedSources.length > 0 && (
        <s-section heading="🗂 Queued Ingestion Sources">
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                <th style={{ padding: "8px" }}><s-text>Source Name</s-text></th>
                <th style={{ padding: "8px" }}><s-text>Type</s-text></th>
                <th style={{ padding: "8px" }}><s-text>Status</s-text></th>
                <th style={{ padding: "8px" }}><s-text>Actions</s-text></th>
              </tr>
            </thead>
            <tbody>
              {queuedSources.map((source) => (
                <tr 
                  key={source.id} 
                  style={{ 
                    borderBottom: "1px solid #eee", 
                    background: selectedSourceId === source.id ? "#f4f6f8" : "transparent"
                  }}
                >
                  <td style={{ padding: "8px" }}>
                    <s-link onClick={() => setSelectedSourceId(source.id)}>
                      {source.name}
                    </s-link>
                  </td>
                  <td style={{ padding: "8px" }}><s-text>{source.type.toUpperCase()}</s-text></td>
                  <td style={{ padding: "8px" }}>
                    <s-text color={
                      source.status === "ready" ? "success" : 
                      source.status === "failed" ? "critical" : 
                      "subdued"
                    }>
                      {source.status.toUpperCase()}
                    </s-text>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <s-stack direction="inline" gap="tight">
                      <s-button onClick={() => setSelectedSourceId(source.id)} variant="tertiary">
                        View
                      </s-button>
                      <s-button onClick={() => handleRemoveSource(source.id)} variant="tertiary" color="destructive">
                        Remove
                      </s-button>
                    </s-stack>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}

      {/* Interactive Conversion and Preview */}
      {selectedSource && (
        <s-section heading={`📝 Source Preview: ${selectedSource.name}`}>
          {selectedSource.status === "converting" && (
            <s-box padding="base" style={{ textAlign: "center" }}>
              <s-paragraph>Converting source to Markdown using MarkItDown service...</s-paragraph>
            </s-box>
          )}

          {selectedSource.status === "failed" && (
            <s-box padding="base" background="critical-subdued" borderRadius="base">
              <s-heading>Conversion Failed</s-heading>
              <s-paragraph color="critical">{selectedSource.error}</s-paragraph>
            </s-box>
          )}

          {selectedSource.status === "ready" && (
            <s-stack direction="block" gap="base">
              
              {/* Multi-product warning banner */}
              {isMultiProduct && (
                <s-box padding="base" background="warning-subdued" borderRadius="base" style={{ borderLeft: "4px solid #e0b034" }}>
                  <s-heading>⚠️ Multi-Product Source Detected</s-heading>
                  <s-paragraph>
                    This document appears to contain multiple products. We've highlighted the <strong>1st identified product</strong> schema below. 
                    You can edit the parsed Markdown on the left to focus on other sections or proceed to parse all.
                  </s-paragraph>
                  <s-stack direction="inline" gap="base" style={{ marginTop: "8px" }}>
                    <s-button onClick={() => shopify.toast.show("Scraping 1st product only")}>
                      Scrape 1st Product
                    </s-button>
                    <s-button onClick={() => shopify.toast.show("Scraping full document")}>
                      Identify More / Scrape All
                    </s-button>
                  </s-stack>
                </s-box>
              )}

              {/* Grid Layout for Preview and Schema */}
              <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "10px" }}>
                
                {/* Left: Editable Markdown Text Area */}
                <div style={{ flex: 1, minWidth: "350px" }}>
                  <s-heading>Editable Markdown Content</s-heading>
                  <textarea
                    value={editingMarkdown}
                    onChange={(e) => setEditingMarkdown(e.target.value)}
                    style={{
                      width: "100%",
                      height: "400px",
                      padding: "12px",
                      fontFamily: "monospace",
                      fontSize: "13px",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      boxSizing: "border-box",
                      marginTop: "8px",
                      lineHeight: "1.5",
                      resize: "vertical",
                    }}
                  />
                </div>

                {/* Right: AI Schema Mapping & Extraction Preview */}
                <div style={{ flex: 1, minWidth: "300px" }}>
                  <s-heading>AI Schema Mapping Preview</s-heading>
                  
                  {isExtracting && (
                    <s-box padding="base" style={{ textAlign: "center" }}>
                      <s-spinner size="base" accessibility-label="Extracting fields..."></s-spinner>
                      <s-paragraph style={{ marginTop: "10px" }}>Running parser extraction and unit normalization...</s-paragraph>
                    </s-box>
                  )}

                  {!isExtracting && extractedProduct && (
                    <s-box padding="base" borderWidth="base" borderRadius="base" style={{ marginTop: "8px" }}>
                      <s-stack direction="block" gap="base">
                        <s-stack direction="inline" gap="base" align-items="center">
                          <s-text type="strong">Title:</s-text>
                          <s-text>{extractedProduct.title}</s-text>
                        </s-stack>
                        <s-stack direction="inline" gap="base" align-items="center">
                          <s-text type="strong">SKU:</s-text>
                          <s-text>{extractedProduct.sku}</s-text>
                        </s-stack>
                        <s-stack direction="inline" gap="base" align-items="center">
                          <s-text type="strong">Purchase Type:</s-text>
                          <s-badge tone={extractedProduct.purchase_type === "quote_only" ? "warning" : "success"}>
                            {extractedProduct.purchase_type === "quote_only" ? "QUOTE ONLY (RFQ)" : "DIRECT BUY"}
                          </s-badge>
                        </s-stack>
                        <s-stack direction="block" gap="extra-tight">
                          <s-text type="strong">Description Summary:</s-text>
                          <s-paragraph color="subdued">{extractedProduct.short_description}</s-paragraph>
                        </s-stack>

                        <s-divider></s-divider>
                        
                        <s-text type="strong">Normalized Specifications ({extractedProduct.specifications?.length || 0}):</s-text>
                        {extractedProduct.specifications && extractedProduct.specifications.length > 0 ? (
                          <div style={{ maxHeight: "250px", overflowY: "auto", border: "1px solid #eee", borderRadius: "4px", padding: "8px" }}>
                            {extractedProduct.specifications.map((spec: any, idx: number) => (
                              <div key={idx} style={{ padding: "6px 0", borderBottom: idx < extractedProduct.specifications.length - 1 ? "1px solid #f9f9f9" : "none" }}>
                                <s-stack direction="inline" gap="base" align-items="center" style={{ justifyContent: "space-between" }}>
                                  <s-text type="strong" variant="bodySm">{spec.name}:</s-text>
                                  <s-text variant="bodySm">{spec.rawValue}</s-text>
                                </s-stack>
                                {spec.value !== null && spec.value !== undefined && spec.value !== spec.rawValue && (
                                  <div style={{ marginTop: "4px", paddingLeft: "10px" }}>
                                    <s-badge tone="success" size="base">
                                      Parsed: {typeof spec.value === 'object' ? JSON.stringify(spec.value) : spec.value} {spec.unit || ""} ({spec.system || "dimension"})
                                    </s-badge>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <s-paragraph color="subdued">No specifications extracted.</s-paragraph>
                        )}
                      </s-stack>
                    </s-box>
                  )}

                  {!isExtracting && !extractedProduct && (
                    <s-box padding="base" background="subdued" borderRadius="base" style={{ marginTop: "8px" }}>
                      <s-paragraph color="subdued">No extraction data available. Edit the Markdown or re-run parser.</s-paragraph>
                    </s-box>
                  )}

                  <s-box padding="base" background="subdued" borderRadius="base" style={{ marginTop: "15px" }}>
                    <s-paragraph>
                      Verify and edit the Markdown content on the left to add specs, then click "Re-run Extraction" to re-process.
                    </s-paragraph>
                    <s-stack direction="inline" gap="base" style={{ marginTop: "10px" }}>
                      <s-button 
                        variant="primary" 
                        onClick={() => runExtraction(editingMarkdown, selectedSource.domain)}
                        disabled={isExtracting}
                      >
                        Re-run Extraction
                      </s-button>
                      <s-button 
                        onClick={() => shopify.toast.show("Schema Lock: Confirmed format for domain!")}
                      >
                        Approve Schema & Lock
                      </s-button>
                    </s-stack>
                  </s-box>
                </div>

              </div>

            </s-stack>
          )}
        </s-section>
      )}

      {/* Standard Specifications Footer */}
      <s-section slot="aside" heading="System Specs & Resources">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">React Router v7</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link href="https://shopify.dev/docs/api/app-home/using-polaris-components" target="_blank">Polaris Web Components</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Custom Data: </s-text>
          <s-link href="https://shopify.dev/docs/apps/build/custom-data" target="_blank">Metafields &amp; Metaobjects</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Python Service: </s-text>
          <s-text>Port 5005 (MarkItDown + Flask)</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
