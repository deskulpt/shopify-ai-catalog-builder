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

/**
 * Convert a markdown/plain-text product description to structured HTML
 * suitable for Shopify's descriptionHtml field.
 *
 * Handles: headings (h2/h3/h4), paragraphs, unordered/ordered bullet lists,
 * bold (**text**), italic (*text*), inline code, horizontal rules, and
 * image/link markdown (images stripped, links converted to <a>).
 */
function markdownToDescriptionHtml(md: string): string {
  if (!md || !md.trim()) return "";

  const lines = md.split("\n");
  const html: string[] = [];
  let inUl = false;
  let inOl = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      const text = para.join(" ").trim();
      if (text) html.push(`<p>${text}</p>`);
      para = [];
    }
  };
  const closeLists = () => {
    if (inUl) { html.push("</ul>"); inUl = false; }
    if (inOl) { html.push("</ol>"); inOl = false; }
  };

  const inlineFormat = (text: string): string => {
    // Strip markdown images entirely
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");
    // Convert links to <a>
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold and italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    text = text.replace(/_(.+?)_/g, "<em>$1</em>");
    // Inline code
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    return text;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stripped = line.trim();

    // Horizontal rules → <hr>
    if (/^---+$|^===+$|^\*\*\*+$/.test(stripped)) {
      flushPara(); closeLists();
      html.push("<hr>");
      continue;
    }

    // Headings
    const headingMatch = stripped.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushPara(); closeLists();
      const level = Math.min(headingMatch[1].length + 1, 4); // map h1→h2, cap at h4
      html.push(`<h${level}>${inlineFormat(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    // Ordered list items
    const olMatch = stripped.match(/^(\d+)[.)\s]\s+(.+)$/);
    if (olMatch) {
      flushPara();
      if (inUl) { html.push("</ul>"); inUl = false; }
      if (!inOl) { html.push("<ol>"); inOl = true; }
      html.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    // Unordered list items (-, *, •)
    const ulMatch = stripped.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (inOl) { html.push("</ol>"); inOl = false; }
      if (!inUl) { html.push("<ul>"); inUl = true; }
      html.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    // Table rows → skip (handled separately as spec table in api.publish)
    if (stripped.startsWith("|") && stripped.endsWith("|")) {
      continue;
    }
    // Table separator rows
    if (/^[|:\-\s]+$/.test(stripped) && stripped.includes("-")) {
      continue;
    }

    // Blank line → end paragraph
    if (!stripped) {
      flushPara(); closeLists();
      continue;
    }

    // Everything else → paragraph content
    closeLists();
    const formatted = inlineFormat(stripped);
    if (formatted.trim()) para.push(formatted);
  }

  flushPara();
  closeLists();

  return html.join("\n");
}

interface QueuedSource {
  id: string;
  name: string;
  type: "file" | "url";
  status: "queued" | "converting" | "ready" | "failed";
  markdown: string;
  error?: string;
  domain?: string;
  extractedData?: any;
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

  const [isSessionLoaded, setIsSessionLoaded] = useState(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [throttleDelay, setThrottleDelay] = useState(3000);

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
      
      if (selectedSource.extractedData) {
        setExtractedProduct(selectedSource.extractedData);
        setIsMultiProduct(false);
      } else {
        // Simple multi-product heuristic: multiple tables or occurrences of SKU / Model
        const skuMatches = (selectedSource.markdown.match(/sku/gi) || []).length;
        const modelMatches = (selectedSource.markdown.match(/model/gi) || []).length;
        setIsMultiProduct(skuMatches > 2 || modelMatches > 2);

        // Trigger field extraction automatically
        runExtraction(selectedSource.markdown, selectedSource.domain);
      }
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
    let catUrls: string[] = [];
    if (groupSimilar && groupedCategories[category.name]) {
      groupedCategories[category.name].forEach((group: any) => {
        if (group.is_grouped) {
          group.variants.forEach((v: any) => catUrls.push(v.url));
        } else {
          catUrls.push(group.variants[0].url);
        }
      });
    } else {
      catUrls = (category.products || []).map((p: any) => p.url);
    }
    
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
  };

  // Grouping & Extraction States
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [isGrouping, setIsGrouping] = useState(false);
  const [groupedCategories, setGroupedCategories] = useState<Record<string, any[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [shopifyCollections, setShopifyCollections] = useState<{id: string; title: string; handle: string; productsCount: number}[]>([]);
  const [customCollections, setCustomCollections] = useState<{id: string; title: string}[]>([]);
  const [groupingStats, setGroupingStats] = useState<{total: number; matched: number; newCount: number} | null>(null);
  // groupCollectionOverride[groupTitle] = collectionId ("" = create new, undefined = use auto-match)
  const [groupCollectionOverride, setGroupCollectionOverride] = useState<Record<string, string>>({});

  const [extractedProduct, setExtractedProduct] = useState<any | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Review modal editing states
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewDescription, setReviewDescription] = useState("");
  const [reviewSku, setReviewSku] = useState("");
  const [reviewPrice, setReviewPrice] = useState("0.00");
  const [reviewPurchaseType, setReviewPurchaseType] = useState<"direct_buy" | "quote_only">("direct_buy");
  const [reviewSpecs, setReviewSpecs] = useState<{ name: string; value: string; selected: boolean }[]>([]);
  const [reviewOptions, setReviewOptions] = useState<{ name: string; values: string[] }[]>([]);
  const [reviewOptionsText, setReviewOptionsText] = useState<string[]>([]);
  const [reviewVariants, setReviewVariants] = useState<{
    id: string;
    optionValues: { optionName: string; name: string }[];
    sku: string;
    price: string;
    selected: boolean;
  }[]>([]);
  const [reviewMediaLinks, setReviewMediaLinks] = useState<{ url: string; alt: string; selected: boolean }[]>([]);
  const [reviewFileLinks, setReviewFileLinks] = useState<{ url: string; text: string; selected: boolean; embed?: boolean }[]>([]);
  const [reviewCurrency, setReviewCurrency] = useState("USD");
  const [reviewPriceUnit, setReviewPriceUnit] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const isHtmlViewerLink = (urlStr: string) => {
    if (!urlStr) return false;
    const urlLower = urlStr.toLowerCase();
    if (urlLower.includes("directindustry.com/pdf/") || urlLower.includes("pdf.directindustry.com")) {
      return true;
    }
    if ((urlLower.includes("/pdf/") || urlLower.includes("/catalog/") || urlLower.includes("/viewer/") || urlLower.includes("/brochure/")) &&
        (urlLower.includes(".html") || urlLower.includes(".php") || !urlLower.endsWith(".pdf"))) {
      return true;
    }
    return false;
  };

  // Parse variants list from markdown tables (Model/SKU/Price columns + option columns)
  const parseVariantsFromMarkdown = (markdown: string, baseSku: string) => {
    const lines = markdown.split("\n");
    const tables: string[][] = [];
    let currentTable: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|")) {
        currentTable.push(trimmed);
      } else if (currentTable.length > 0) {
        if (currentTable.length >= 3) {
          tables.push(currentTable);
        }
        currentTable = [];
      }
    }
    if (currentTable.length >= 3) {
      tables.push(currentTable);
    }
    
    for (const tableLines of tables) {
      const headers = tableLines[0]
        .split("|")
        .map(s => s.trim())
        .filter((_, i, arr) => i > 0 && i < arr.length - 1);
        
      const hasSkuOrModel = headers.some(h => 
        /sku|model|part\s*number|p\/n|type/i.test(h)
      );
      const potentialOptions = headers.filter(h => 
        h && h.trim() !== "" && !/sku|model|part\s*number|p\/n|price|cost|description|spec|value|image|img|photo|logo/i.test(h)
      );
      
      if (hasSkuOrModel && potentialOptions.length > 0) {
        const optionDefs = potentialOptions.map(name => ({
          name,
          values: new Set<string>()
        }));
        
        const parsedVariants: any[] = [];
        
        for (let i = 2; i < tableLines.length; i++) {
          const cells = tableLines[i]
            .split("|")
            .map(s => s.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            
          if (cells.length === headers.length) {
            const rowData: Record<string, string> = {};
            headers.forEach((h, idx) => {
              rowData[h] = cells[idx];
            });
            
            const skuHeader = headers.find(h => h && h.trim() !== "" && /sku|part\s*number|p\/n/i.test(h));
            const modelHeader = headers.find(h => h && h.trim() !== "" && /model|type/i.test(h));
            const priceHeader = headers.find(h => h && h.trim() !== "" && /price|cost/i.test(h));
            
            const variantSku = (skuHeader ? rowData[skuHeader] : "") || (modelHeader ? rowData[modelHeader] : "") || "";
            const variantPrice = priceHeader ? rowData[priceHeader] : "0.00";
            
            const optValues = potentialOptions.map(name => {
              const val = rowData[name] || "Standard";
              const optDef = optionDefs.find(o => o.name === name);
              if (optDef) optDef.values.add(val);
              return { optionName: name, name: val };
            });
            
            parsedVariants.push({
              id: Math.random().toString(36).substring(7),
              optionValues: optValues,
              sku: variantSku || `${baseSku}-${optValues.map(v => v.name.replace(/\s+/g, "-")).join("-")}`,
              price: variantPrice.replace(/[^0-9.]/g, "") || "0.00",
              selected: true
            });
          }
        }
        
        if (parsedVariants.length > 0) {
          return {
            options: optionDefs.map(o => ({ name: o.name, values: Array.from(o.values) })),
            variants: parsedVariants
          };
        }
      }
    }
    return null;
  };

  const generateCombinations = (
    optList: { name: string; values: string[] }[],
    index = 0,
    current: { optionName: string; name: string }[] = []
  ): { optionValues: { optionName: string; name: string }[] }[] => {
    if (index === optList.length) {
      return [{ optionValues: current }];
    }
    const currentOpt = optList[index];
    const results: any[] = [];
    for (const val of currentOpt.values) {
      results.push(
        ...generateCombinations(optList, index + 1, [
          ...current,
          { optionName: currentOpt.name, name: val },
        ])
      );
    }
    return results;
  };

  const updateVariantsFromOptions = (
    newOptions: { name: string; values: string[] }[],
    baseSkuVal = reviewSku,
    basePriceVal = reviewPrice
  ) => {
    if (newOptions.length === 0) {
      setReviewVariants([]);
      return;
    }
    
    const combs = generateCombinations(newOptions);
    setReviewVariants(prev => {
      return combs.map(comb => {
        const existing = prev.find(rv => 
          rv.optionValues.every(ov => 
            comb.optionValues.some(cov => cov.optionName === ov.optionName && cov.name === ov.name)
          )
        );
        
        if (existing) {
          return existing;
        }
        
        const skuSuffix = comb.optionValues.map(ov => ov.name.replace(/\s+/g, "-")).join("-");
        return {
          id: Math.random().toString(36).substring(7),
          optionValues: comb.optionValues,
          sku: baseSkuVal ? `${baseSkuVal}-${skuSuffix}` : skuSuffix,
          price: basePriceVal || "0.00",
          selected: true,
        };
      });
    });
  };

  const handleOpenReviewModal = () => {
    if (!extractedProduct) return;
    
    setReviewTitle(extractedProduct.title || "");
    setReviewDescription(extractedProduct.short_description || "");
    setReviewSku(extractedProduct.sku || "");
    setReviewPrice(extractedProduct.price || "0.00");
    setReviewCurrency(extractedProduct.currency || "USD");
    setReviewPriceUnit(extractedProduct.price_unit || "");
    setReviewPurchaseType(extractedProduct.purchase_type || "direct_buy");
    
    const specs = (extractedProduct.specifications || []).map((s: any) => ({
      name: s.name,
      value: s.displayValue || (s.value !== null && s.value !== undefined ? (s.unit ? `${s.value} ${s.unit}` : String(s.value)) : String(s.rawValue)),
      selected: true,
    }));
    setReviewSpecs(specs);

    const media = (extractedProduct.media_links || []).map((m: any) => ({
      url: m.url,
      alt: m.alt || "",
      selected: true,
    }));
    setReviewMediaLinks(media);

    const files = (extractedProduct.file_links || []).map((f: any) => ({
      url: f.url,
      text: f.text || "",
      selected: true,
      embed: isHtmlViewerLink(f.url),
    }));
    setReviewFileLinks(files);
    
    const parsed = parseVariantsFromMarkdown(editingMarkdown, extractedProduct.sku || "");
    if (parsed) {
      setReviewOptions(parsed.options);
      setReviewOptionsText(parsed.options.map(o => o.values.join(", ")));
      setReviewVariants(parsed.variants);
    } else {
      setReviewOptions([]);
      setReviewOptionsText([]);
      setReviewVariants([]);
    }
    
    setIsReviewOpen(true);
  };

  const handleBaseSkuChange = (newSku: string) => {
    setReviewSku(newSku);
    setReviewVariants(prev => prev.map(v => {
      const skuSuffix = v.optionValues.map(ov => ov.name.replace(/\s+/g, "-")).join("-");
      const expectedPrevSku = reviewSku ? `${reviewSku}-${skuSuffix}` : skuSuffix;
      if (v.sku === expectedPrevSku || !v.sku) {
        return { ...v, sku: newSku ? `${newSku}-${skuSuffix}` : skuSuffix };
      }
      return v;
    }));
  };

  const handleEnableVariants = () => {
    const initialOpts = [{ name: "Model", values: ["Standard"] }];
    setReviewOptions(initialOpts);
    setReviewOptionsText(["Standard"]);
    updateVariantsFromOptions(initialOpts);
  };

  const handleAddOption = () => {
    const nextOpts = [...reviewOptions, { name: `Option ${reviewOptions.length + 1}`, values: ["Standard"] }];
    setReviewOptions(nextOpts);
    setReviewOptionsText([...reviewOptionsText, "Standard"]);
    updateVariantsFromOptions(nextOpts);
  };

  const handleUpdateOptionName = (idx: number, newName: string) => {
    const oldName = reviewOptions[idx].name;
    const nextOpts = reviewOptions.map((o, i) => i === idx ? { ...o, name: newName } : o);
    setReviewOptions(nextOpts);
    setReviewVariants(prev => prev.map(v => ({
      ...v,
      optionValues: v.optionValues.map(ov => ov.optionName === oldName ? { ...ov, optionName: newName } : ov)
    })));
  };

  const handleOptionValuesChange = (idx: number, text: string) => {
    const nextText = [...reviewOptionsText];
    nextText[idx] = text;
    setReviewOptionsText(nextText);
    
    const vals = text.split(",").map(v => v.trim()).filter(Boolean);
    const nextOpts = reviewOptions.map((o, i) => i === idx ? { ...o, values: vals } : o);
    setReviewOptions(nextOpts);
    updateVariantsFromOptions(nextOpts, reviewSku, reviewPrice);
  };

  const handleRemoveOption = (idx: number) => {
    const nextOpts = reviewOptions.filter((_, i) => i !== idx);
    const nextText = reviewOptionsText.filter((_, i) => i !== idx);
    setReviewOptions(nextOpts);
    setReviewOptionsText(nextText);
    updateVariantsFromOptions(nextOpts);
  };

  const handleAddSpec = () => {
    setReviewSpecs(prev => [...prev, { name: "New Spec", value: "", selected: true }]);
  };

  const handleUpdateSpec = (idx: number, field: "name" | "value", val: string) => {
    setReviewSpecs(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  };

  const handleToggleSpec = (idx: number, checked: boolean) => {
    setReviewSpecs(prev => prev.map((s, i) => i === idx ? { ...s, selected: checked } : s));
  };

  const handleRemoveSpec = (idx: number) => {
    setReviewSpecs(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateVariantSku = (id: string, newSku: string) => {
    setReviewVariants(prev => prev.map(v => v.id === id ? { ...v, sku: newSku } : v));
  };

  const handleUpdateVariantPrice = (id: string, newPrice: string) => {
    setReviewVariants(prev => prev.map(v => v.id === id ? { ...v, price: newPrice } : v));
  };

  const handleToggleVariant = (id: string, checked: boolean) => {
    setReviewVariants(prev => prev.map(v => v.id === id ? { ...v, selected: checked } : v));
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const payload = {
        title: reviewTitle,
        descriptionHtml: markdownToDescriptionHtml(reviewDescription),
        sku: reviewSku,
        price: reviewPrice,
        currency: reviewCurrency,
        price_unit: reviewPriceUnit,
        purchase_type: reviewPurchaseType,
        specifications: reviewSpecs.filter(s => s.selected).map(s => ({ name: s.name, value: s.value })),
        variants: reviewVariants.filter(v => v.selected),
        options: reviewOptions,
        media_links: reviewMediaLinks.filter(m => m.selected).map(m => ({ url: m.url, alt: m.alt })),
        file_links: reviewFileLinks.filter(f => f.selected).map(f => ({ url: f.url, text: f.text, embed: f.embed })),
      };
      
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      if (data.success) {
        shopify.toast.show("Product published successfully as DRAFT!");
        setIsReviewOpen(false);
        if (selectedSourceId) {
          setQueuedSources(prev => 
            prev.map(s => s.id === selectedSourceId 
              ? { ...s, status: "ready" as const, name: `✓ ${s.name.replace(/^✓ /, "")}` } 
              : s
            )
          );
        }
      } else {
        shopify.toast.show(`Publishing failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      shopify.toast.show(`Error: ${err.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  // --- Session Persistence & Queue Processing ---
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ingest_ai_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.queuedSources) setQueuedSources(parsed.queuedSources);
        if (parsed.crawlResult) setCrawlResult(parsed.crawlResult);
        if (parsed.customCollections) setCustomCollections(parsed.customCollections);
        if (parsed.selectedSourceId) setSelectedSourceId(parsed.selectedSourceId);
      }
    } catch (e) {
      console.error("Failed to load session", e);
    }
    setIsSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (isSessionLoaded) {
      const session = { queuedSources, crawlResult, customCollections, selectedSourceId };
      localStorage.setItem("ingest_ai_session", JSON.stringify(session));
    }
  }, [queuedSources, crawlResult, customCollections, selectedSourceId, isSessionLoaded]);

  useEffect(() => {
    if (!isProcessingQueue) return;

    const nextSource = queuedSources.find(s => s.status === "queued");
    if (!nextSource) {
      if (queuedSources.some(s => s.status === "converting")) {
        return; // Wait for current to finish
      }
      setIsProcessingQueue(false);
      shopify.toast.show("Queue processing complete!");
      return;
    }

    const currentlyConverting = queuedSources.filter(s => s.status === "converting").length;
    if (currentlyConverting > 0) return;

    let isMounted = true;
    const processNext = async () => {
      // Randomize the delay to avoid forming a predictable pattern
      // Wait between throttleDelay and (throttleDelay * 1.8) milliseconds
      const randomDelay = throttleDelay + Math.floor(Math.random() * (throttleDelay * 0.8));
      await new Promise(r => setTimeout(r, randomDelay));
      if (!isMounted) return;
      triggerUrlIngestion(nextSource);
    };

    processNext();
    return () => { isMounted = false; };
  }, [queuedSources, isProcessingQueue, throttleDelay]);
  // ----------------------------------------------

  const handleScrapeFirstOnly = () => {
    if (extractedProduct?.is_multi && extractedProduct.products?.length > 0) {
      const firstProduct = extractedProduct.products[0];
      setExtractedProduct({
        ...firstProduct,
        is_multi: false,
        success: true
      });
      setIsMultiProduct(false);
      if (firstProduct.section_markdown) {
        setEditingMarkdown(firstProduct.section_markdown);
      }
      shopify.toast.show("Focused on 1st product only");
    }
  };

  const handleSplitMultiProducts = () => {
    if (!selectedSource || !extractedProduct?.is_multi || !extractedProduct.products) {
      return;
    }

    const newSources: QueuedSource[] = extractedProduct.products.map((prod: any) => {
      return {
        id: Math.random().toString(36).substring(7),
        name: prod.title || "Split Product",
        type: selectedSource.type,
        status: "ready",
        markdown: prod.section_markdown || "",
        domain: selectedSource.domain,
        extractedData: {
          ...prod,
          is_multi: false,
          success: true
        }
      };
    });

    if (newSources.length === 0) return;

    // Replace the selected parent source in the queue with the new ones
    setQueuedSources(prev => {
      const idx = prev.findIndex(s => s.id === selectedSource.id);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated.splice(idx, 1, ...newSources);
      return updated;
    });

    // Select the first new source
    setSelectedSourceId(newSources[0].id);
    shopify.toast.show(`Split into ${newSources.length} individual products`);
  };

  const handleGroupToggle = async (checked: boolean) => {
    setGroupSimilar(checked);
    if (!checked || !crawlResult) return;

    setIsGrouping(true);
    const newGroupedCats: Record<string, any[]> = {};
    let totalStats = { total: 0, matched: 0, new: 0 };

    try {
      // Step 1: Fetch existing Shopify collections once
      let collections: {id: string; title: string}[] = shopifyCollections;
      if (collections.length === 0) {
        try {
          const colRes = await fetch("/api/collections");
          const colData = await colRes.json();
          if (colData.success && colData.collections) {
            setShopifyCollections(colData.collections);
            collections = colData.collections;
          }
        } catch (_) {
          // Proceed without collections
        }
      }

      // Step 2: Group each category, passing the collections for matching
      for (const category of crawlResult.categories) {
        const catProducts = category.products || [];
        if (catProducts.length <= 1) {
          newGroupedCats[category.name] = catProducts.map((p: any) => ({
            title: p.name,
            is_grouped: false,
            variants: [p],
            collection_match: null,
          }));
          totalStats.total += catProducts.length;
          totalStats.new += catProducts.length;
          continue;
        }

        const res = await fetch("/api/group-variants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products: catProducts, collections }),
        });
        const data = await res.json();
        if (data.success) {
          newGroupedCats[category.name] = data.grouped;
          if (data.stats) {
            totalStats.total += data.stats.total;
            totalStats.matched += data.stats.matched;
            totalStats.new += data.stats.new;
          }
        } else {
          newGroupedCats[category.name] = catProducts.map((p: any) => ({
            title: p.name,
            is_grouped: false,
            variants: [p],
            collection_match: null,
          }));
          totalStats.total += catProducts.length;
          totalStats.new += catProducts.length;
        }
      }
      setGroupedCategories(newGroupedCats);
      setGroupingStats({ total: totalStats.total, matched: totalStats.matched, newCount: totalStats.new });
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
        body: JSON.stringify({
          markdown: mdContent,
          domain: domainStr,
          url: selectedSource?.type === "url" ? selectedSource.name : undefined
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.is_multi && data.products?.length > 0) {
          setExtractedProduct({
            ...data.products[0],
            ...data
          });
          setIsMultiProduct(true);
        } else {
          setExtractedProduct(data);
        }
      } else {
        shopify.toast.show(`Extraction failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      shopify.toast.show(`Extraction error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const allCollections = [
    ...shopifyCollections,
    ...customCollections.map(c => ({ id: c.id, title: c.title, handle: "", productsCount: 0 }))
  ];

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

              {/* Collection Grouping Stats Bar */}
              {groupSimilar && groupingStats && (
                <s-box
                  padding="small"
                  background="base"
                  borderRadius="base"
                  style={{
                    marginBottom: "12px",
                    border: "1px solid #e1e3e5",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexWrap: "wrap"
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>Collection Analysis:</span>
                  <span style={{
                    background: "#f0fdf4", color: "#166534",
                    padding: "2px 10px", borderRadius: "12px",
                    fontSize: "12px", fontWeight: 600, border: "1px solid #bbf7d0"
                  }}>
                    ✓ {groupingStats.matched} matched to existing
                  </span>
                  <span style={{
                    background: "#fff7ed", color: "#9a3412",
                    padding: "2px 10px", borderRadius: "12px",
                    fontSize: "12px", fontWeight: 600, border: "1px solid #fed7aa"
                  }}>
                    + {groupingStats.newCount} new collections
                  </span>
                  <span style={{ color: "#6d7175", fontSize: "12px" }}>
                    {groupingStats.total} total groups · {shopifyCollections.length} Shopify collections loaded
                  </span>
                </s-box>
              )}

              <div style={{ paddingLeft: "10px" }}>

                {crawlResult.categories.map((category: any) => {
                  const isCatExpanded = !!expandedCategories[category.name];
                  const catProducts = category.products || [];
                  
                  let catUrlsForCat: string[] = [];
                  if (groupSimilar && groupedCategories[category.name]) {
                    groupedCategories[category.name].forEach((group: any) => {
                      if (group.is_grouped) {
                        group.variants.forEach((v: any) => catUrlsForCat.push(v.url));
                      } else {
                        catUrlsForCat.push(group.variants[0].url);
                      }
                    });
                  } else {
                    catUrlsForCat = (category.products || []).map((p: any) => p.url);
                  }

                  const selectedInCat = selectedProducts.filter(url => catUrlsForCat.includes(url));
                  const isAllSelected = catUrlsForCat.length > 0 && selectedInCat.length === catUrlsForCat.length;
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
                                  <div key={group.title} style={{ margin: "10px 0", paddingLeft: "15px", borderLeft: `2px solid ${group.collection_match ? "#008060" : "#ffa500"}` }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
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
                                        style={{ cursor: "pointer", width: "14px", height: "14px", marginTop: "4px" }}
                                      />
                                      <div style={{ flex: 1 }}>
                                        <s-stack direction="inline" gap="tight" align-items="center" style={{ flexWrap: "wrap" }}>
                                          <s-text type="strong">{group.title}</s-text>
                                          <s-badge tone="info">{group.variants.length} Variants</s-badge>
                                          {group.options && group.options.map((opt: string) => (
                                            <s-chip key={opt} size="base">{opt}</s-chip>
                                          ))}
                                        </s-stack>

                                        {/* Collection assignment row */}
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                                          {/* Auto-match badge */}
                                          {group.collection_match && groupCollectionOverride[group.title] === undefined && (
                                            <span style={{
                                              background: "#f0fdf4", color: "#166534",
                                              padding: "2px 8px", borderRadius: "10px",
                                              fontSize: "11px", border: "1px solid #bbf7d0",
                                              display: "inline-flex", alignItems: "center", gap: "4px"
                                            }}>
                                              📁 {group.collection_match.title}
                                              <span style={{ opacity: 0.7 }}>
                                                ({Math.round(group.collection_match.score * 100)}% match)
                                              </span>
                                            </span>
                                          )}
                                          {!group.collection_match && groupCollectionOverride[group.title] === undefined && (
                                            <span style={{
                                              background: "#fff7ed", color: "#9a3412",
                                              padding: "2px 8px", borderRadius: "10px",
                                              fontSize: "11px", border: "1px solid #fed7aa"
                                            }}>
                                              ✦ New Collection
                                            </span>
                                          )}
                                          {groupCollectionOverride[group.title] !== undefined && (
                                            <span style={{
                                              background: groupCollectionOverride[group.title] ? "#f0fdf4" : "#fff7ed",
                                              color: groupCollectionOverride[group.title] ? "#166534" : "#9a3412",
                                              padding: "2px 8px", borderRadius: "10px",
                                              fontSize: "11px",
                                              border: `1px solid ${groupCollectionOverride[group.title] ? "#bbf7d0" : "#fed7aa"}`
                                            }}>
                                              {groupCollectionOverride[group.title]
                                                ? `📁 ${allCollections.find(c => c.id === groupCollectionOverride[group.title])?.title ?? "Selected"}`
                                                : "✦ New Collection"}
                                            </span>
                                          )}

                                          {/* Override dropdown */}
                                          <select
                                            value={groupCollectionOverride[group.title] ?? (group.collection_match?.id ?? "")}
                                            onChange={(e) => setGroupCollectionOverride(prev => ({
                                              ...prev,
                                              [group.title]: e.target.value
                                            }))}
                                            style={{
                                              fontSize: "11px",
                                              padding: "2px 6px",
                                              borderRadius: "6px",
                                              border: "1px solid #c9cccf",
                                              background: "white",
                                              cursor: "pointer",
                                              maxWidth: "200px"
                                            }}
                                          >
                                            <option value="">＋ Create new collection</option>
                                            {allCollections.map((col) => (
                                              <option key={col.id} value={col.id}>
                                                {col.title} {col.productsCount !== undefined && col.productsCount > 0 ? `(${col.productsCount})` : ""}
                                              </option>
                                            ))}
                                          </select>

                                          {/* New Collection Input */}
                                          {groupCollectionOverride[group.title] === "" && (
                                            <input
                                              type="text"
                                              placeholder="Collection name..."
                                              autoFocus
                                              onBlur={(e) => {
                                                const val = e.target.value.trim();
                                                if (val) {
                                                  const newId = 'custom_' + Date.now() + Math.floor(Math.random()*1000);
                                                  setCustomCollections(prev => [...prev, { id: newId, title: val }]);
                                                  setGroupCollectionOverride(prev => ({ ...prev, [group.title]: newId }));
                                                }
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  const val = e.currentTarget.value.trim();
                                                  if (val) {
                                                    const newId = 'custom_' + Date.now() + Math.floor(Math.random()*1000);
                                                    setCustomCollections(prev => [...prev, { id: newId, title: val }]);
                                                    setGroupCollectionOverride(prev => ({ ...prev, [group.title]: newId }));
                                                  }
                                                }
                                              }}
                                              style={{
                                                fontSize: "11px", padding: "2px 6px",
                                                borderRadius: "6px", border: "1px solid #008060",
                                                maxWidth: "150px"
                                              }}
                                            />
                                          )}
                                        </div>
                                      </div>
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
                                                  {variant.url} {variant.option_values && `| ${JSON.stringify(variant.option_values)}`}
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
                                const collMatch = group.collection_match;
                                const overrideId = groupCollectionOverride[standalone.name];
                                return (
                                  <div key={standalone.url} style={{ margin: "6px 0", paddingLeft: "15px" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => handleProductSelectToggle(standalone.url)}
                                        style={{ cursor: "pointer", marginTop: "3px" }}
                                      />
                                      <div style={{ flex: 1 }}>
                                        <s-stack direction="block">
                                          <s-text>{standalone.name}</s-text>
                                          <s-text variant="bodySm" color="subdued">{standalone.url}</s-text>
                                        </s-stack>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                                          {collMatch && overrideId === undefined && (
                                            <span style={{
                                              background: "#f0fdf4", color: "#166534",
                                              padding: "1px 7px", borderRadius: "10px",
                                              fontSize: "10px", border: "1px solid #bbf7d0"
                                            }}>📁 {collMatch.title} ({Math.round(collMatch.score * 100)}%)</span>
                                          )}
                                          {!collMatch && overrideId === undefined && (
                                            <span style={{
                                              background: "#fff7ed", color: "#9a3412",
                                              padding: "1px 7px", borderRadius: "10px",
                                              fontSize: "10px", border: "1px solid #fed7aa"
                                            }}>✦ New</span>
                                          )}
                                          <select
                                            value={overrideId ?? (collMatch?.id ?? "")}
                                            onChange={(e) => setGroupCollectionOverride(prev => ({
                                              ...prev,
                                              [standalone.name]: e.target.value
                                            }))}
                                            style={{
                                              fontSize: "10px", padding: "1px 5px",
                                              borderRadius: "5px", border: "1px solid #c9cccf",
                                              background: "white", cursor: "pointer", maxWidth: "180px"
                                            }}
                                          >
                                            <option value="">＋ New collection</option>
                                            {allCollections.map((col) => (
                                              <option key={col.id} value={col.id}>{col.title}</option>
                                            ))}
                                          </select>
                                          
                                          {/* New Collection Input */}
                                          {overrideId === "" && (
                                            <input
                                              type="text"
                                              placeholder="Collection name..."
                                              autoFocus
                                              onBlur={(e) => {
                                                const val = e.target.value.trim();
                                                if (val) {
                                                  const newId = 'custom_' + Date.now() + Math.floor(Math.random()*1000);
                                                  setCustomCollections(prev => [...prev, { id: newId, title: val }]);
                                                  setGroupCollectionOverride(prev => ({ ...prev, [standalone.name]: newId }));
                                                }
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  const val = e.currentTarget.value.trim();
                                                  if (val) {
                                                    const newId = 'custom_' + Date.now() + Math.floor(Math.random()*1000);
                                                    setCustomCollections(prev => [...prev, { id: newId, title: val }]);
                                                    setGroupCollectionOverride(prev => ({ ...prev, [standalone.name]: newId }));
                                                  }
                                                }
                                              }}
                                              style={{
                                                fontSize: "10px", padding: "1px 5px",
                                                borderRadius: "5px", border: "1px solid #008060",
                                                maxWidth: "120px"
                                              }}
                                            />
                                          )}
                                        </div>
                                      </div>
                                    </div>
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
          <s-stack direction="inline" gap="base" align-items="center" style={{ marginBottom: "15px", flexWrap: "wrap" }}>
            <s-button 
              variant={isProcessingQueue ? "destructive" : "primary"}
              onClick={() => setIsProcessingQueue(!isProcessingQueue)}
              disabled={!queuedSources.some(s => s.status === "queued") && !isProcessingQueue}
            >
              {isProcessingQueue ? "Pause Processing" : "Start Processing Queue"}
            </s-button>
            <s-button onClick={() => {
              if (confirm("Clear all queued sources and session data?")) {
                setQueuedSources([]);
                setCrawlResult(null);
                setCustomCollections([]);
                setSelectedSourceId(null);
                setIsProcessingQueue(false);
                localStorage.removeItem("ingest_ai_session");
              }
            }}>
              Clear Session
            </s-button>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
              <s-text>Delay (ms):</s-text>
              <input 
                type="number" 
                value={throttleDelay} 
                onChange={(e) => setThrottleDelay(Number(e.target.value))}
                min="500" 
                step="500"
                style={{ width: "80px", padding: "4px", borderRadius: "4px", border: "1px solid #ccc" }}
              />
            </div>
          </s-stack>

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
                    <s-button onClick={handleScrapeFirstOnly}>
                      Scrape 1st Product
                    </s-button>
                    <s-button onClick={handleSplitMultiProducts}>
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
                        variant="primary"
                        onClick={handleOpenReviewModal}
                        disabled={!extractedProduct}
                        style={{ background: "linear-gradient(135deg, #008060 0%, #005e46 100%)", color: "white" }}
                      >
                        Review & Publish
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

      {/* Review & Publish Drawer/Modal Overlay */}
      {isReviewOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
          animation: "fadeIn 0.2s ease-out",
        }}>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleIn {
              from { transform: scale(0.96); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            .review-input {
              width: 100%;
              padding: 10px 12px;
              border: 1px solid #c9cccf;
              border-radius: 6px;
              font-size: 14px;
              font-family: inherit;
              box-sizing: border-box;
              transition: border-color 0.15s ease-in-out;
            }
            .review-input:focus {
              border-color: #008060;
              outline: none;
              box-shadow: 0 0 0 2px rgba(0, 128, 96, 0.2);
            }
            .review-textarea {
              width: 100%;
              height: 100px;
              padding: 10px 12px;
              border: 1px solid #c9cccf;
              border-radius: 6px;
              font-size: 14px;
              font-family: inherit;
              box-sizing: border-box;
              resize: vertical;
            }
            .review-textarea:focus {
              border-color: #008060;
              outline: none;
              box-shadow: 0 0 0 2px rgba(0, 128, 96, 0.2);
            }
            .review-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
            }
            .review-table th {
              background-color: #f6f6f7;
              padding: 10px;
              font-size: 13px;
              font-weight: 600;
              text-align: left;
              border-bottom: 1px solid #e1e3e5;
            }
            .review-table td {
              padding: 8px 10px;
              font-size: 13px;
              border-bottom: 1px solid #e1e3e5;
              vertical-align: middle;
            }
          `}</style>
          
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            width: "90%",
            maxWidth: "850px",
            maxHeight: "90vh",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            border: "1px solid rgba(225, 227, 229, 0.8)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            {/* Modal Header */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              borderBottom: "1px solid #e1e3e5",
              background: "#fafbfb",
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#1a1c1d" }}>
                  Review &amp; Publish Product
                </h2>
                <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#6d7175" }}>
                  Configure product details and variant rules before publishing to Shopify.
                </p>
              </div>
              <button 
                onClick={() => setIsReviewOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "24px",
                  cursor: "pointer",
                  color: "#6d7175",
                  padding: "4px 8px",
                  borderRadius: "4px",
                }}
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div style={{
              padding: "24px",
              overflowY: "auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}>
              
              {/* Part 1: Basic Info */}
              <div>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                  Product details
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                      Product Title
                    </label>
                    <input 
                      type="text" 
                      className="review-input" 
                      value={reviewTitle} 
                      onChange={(e) => setReviewTitle(e.target.value)} 
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                      Description Summary
                    </label>
                    <textarea 
                      className="review-textarea" 
                      value={reviewDescription} 
                      onChange={(e) => setReviewDescription(e.target.value)} 
                    />
                  </div>
                  {reviewOptions.length === 0 && (
                    <div style={{ display: "flex", gap: "16px" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                          SKU
                        </label>
                        <input 
                          type="text" 
                          className="review-input" 
                          value={reviewSku} 
                          onChange={(e) => handleBaseSkuChange(e.target.value)} 
                        />
                      </div>
                      {reviewPurchaseType !== "quote_only" && (
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                            Price
                          </label>
                          <input 
                            type="text" 
                            className="review-input" 
                            value={reviewPrice} 
                            onChange={(e) => setReviewPrice(e.target.value)} 
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Currency & Selling Unit Row (Shown for all products) */}
                  <div style={{ display: "flex", gap: "16px" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                        Currency
                      </label>
                      <select 
                        className="review-input"
                        value={reviewCurrency}
                        onChange={(e) => setReviewCurrency(e.target.value)}
                      >
                        <option value="USD">USD ($)</option>
                        <option value="CAD">CAD (C$)</option>
                        <option value="INR">INR (₹)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="EUR">EUR (€)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px", color: "#303030" }}>
                        Selling Unit / Qty Attribute
                      </label>
                      <input 
                        type="text" 
                        className="review-input" 
                        placeholder="e.g. Piece, Meter, Kg, roll"
                        value={reviewPriceUnit} 
                        onChange={(e) => setReviewPriceUnit(e.target.value)} 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Part 2: Purchase Type selector */}
              <div>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                  Purchase Type
                </h3>
                <div style={{ display: "flex", borderRadius: "8px", overflow: "hidden", border: "1px solid #c9cccf", width: "fit-content" }}>
                  <button
                    onClick={() => setReviewPurchaseType("direct_buy")}
                    style={{
                      padding: "10px 20px",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: reviewPurchaseType === "direct_buy" ? "#008060" : "#ffffff",
                      color: reviewPurchaseType === "direct_buy" ? "#ffffff" : "#6d7175",
                      transition: "all 0.2s",
                    }}
                  >
                    Direct Buy (Standard Checkout)
                  </button>
                  <button
                    onClick={() => setReviewPurchaseType("quote_only")}
                    style={{
                      padding: "10px 20px",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: reviewPurchaseType === "quote_only" ? "#e0b034" : "#ffffff",
                      color: reviewPurchaseType === "quote_only" ? "#ffffff" : "#6d7175",
                      transition: "all 0.2s",
                    }}
                  >
                    Request Quote Only (RFQ)
                  </button>
                </div>
                <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#6d7175", fontStyle: "italic" }}>
                  {reviewPurchaseType === "quote_only" 
                    ? "✓ Quote-only mode sets base price to $0.00/null, disables checkout, and flags metafield." 
                    : "✓ Direct buy enables standard price checkout and cart options."
                  }
                </p>
              </div>

              {/* Part 3: Specifications list */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                    Specifications
                  </h3>
                  <button
                    onClick={handleAddSpec}
                    style={{
                      border: "1px dashed #008060",
                      background: "transparent",
                      color: "#008060",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 500,
                    }}
                  >
                    + Add Specification
                  </button>
                </div>
                {reviewSpecs.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "13px", color: "#6d7175" }}>No specifications added.</p>
                ) : (
                  <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
                    <table className="review-table">
                      <thead>
                        <tr>
                          <th style={{ width: "80px", textAlign: "center" }}>Include?</th>
                          <th>Spec Name</th>
                          <th>Value</th>
                          <th style={{ width: "60px", textAlign: "center" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewSpecs.map((spec, idx) => (
                          <tr key={idx} style={{ opacity: spec.selected ? 1 : 0.6 }}>
                            <td style={{ textAlign: "center" }}>
                              <input 
                                type="checkbox" 
                                checked={spec.selected} 
                                onChange={(e) => handleToggleSpec(idx, e.target.checked)} 
                                style={{ width: "16px", height: "16px", cursor: "pointer" }}
                              />
                            </td>
                            <td>
                              <input 
                                type="text" 
                                className="review-input" 
                                value={spec.name} 
                                onChange={(e) => handleUpdateSpec(idx, "name", e.target.value)} 
                              />
                            </td>
                            <td>
                              <input 
                                type="text" 
                                className="review-input" 
                                value={spec.value} 
                                onChange={(e) => handleUpdateSpec(idx, "value", e.target.value)} 
                              />
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <button
                                onClick={() => handleRemoveSpec(idx)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#bf0711",
                                  cursor: "pointer",
                                  fontSize: "18px",
                                }}
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Part 3.5: Discovered Media & Files */}
              {((reviewMediaLinks && reviewMediaLinks.length > 0) || (reviewFileLinks && reviewFileLinks.length > 0)) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px", borderTop: "1px solid #e1e3e5", paddingTop: "20px" }}>
                  {reviewMediaLinks && reviewMediaLinks.length > 0 && (
                    <div>
                      <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                        Discovered Images ({reviewMediaLinks.length})
                      </h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "12px", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px", maxHeight: "250px", overflowY: "auto" }}>
                        {reviewMediaLinks.map((media, idx) => (
                          <div 
                            key={idx} 
                            style={{ 
                              position: "relative", 
                              border: "1px solid #e1e3e5", 
                              borderRadius: "6px", 
                              padding: "4px", 
                              display: "flex", 
                              flexDirection: "column", 
                              alignItems: "center", 
                              backgroundColor: media.selected ? "#f0fdf4" : "#ffffff", 
                              borderColor: media.selected ? "#008060" : "#e1e3e5",
                              transition: "all 0.2s" 
                            }}
                          >
                            <input 
                              type="checkbox" 
                              checked={media.selected} 
                              onChange={(e) => setReviewMediaLinks(prev => prev.map((m, i) => i === idx ? { ...m, selected: e.target.checked } : m))}
                              style={{ position: "absolute", top: "4px", left: "4px", cursor: "pointer", width: "16px", height: "16px", zIndex: 2 }}
                            />
                            <div style={{ width: "100%", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: "4px" }}>
                              <img src={media.url} alt={media.alt || "Product image"} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                            </div>
                            <span style={{ fontSize: "10px", color: "#6d7175", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", width: "100%", textAlign: "center" }}>
                              {media.alt || `Image ${idx + 1}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reviewFileLinks && reviewFileLinks.length > 0 && (
                    <div>
                      <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                        Discovered Documents &amp; PDFs ({reviewFileLinks.length})
                      </h3>
                      <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
                        <table className="review-table">
                          <thead>
                            <tr>
                              <th style={{ width: "80px", textAlign: "center" }}>Attach?</th>
                              <th>Link Text / Description</th>
                              <th>URL</th>
                              <th style={{ width: "120px", textAlign: "center" }}>Embed as Iframe?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reviewFileLinks.map((file, idx) => (
                              <tr key={idx} style={{ opacity: file.selected ? 1 : 0.6 }}>
                                <td style={{ textAlign: "center" }}>
                                  <input 
                                    type="checkbox" 
                                    checked={file.selected} 
                                    onChange={(e) => setReviewFileLinks(prev => prev.map((f, i) => i === idx ? { ...f, selected: e.target.checked } : f))} 
                                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                                  />
                                </td>
                                <td>
                                  <input 
                                    type="text" 
                                    className="review-input" 
                                    value={file.text} 
                                    onChange={(e) => setReviewFileLinks(prev => prev.map((f, i) => i === idx ? { ...f, text: e.target.value } : f))} 
                                  />
                                </td>
                                <td>
                                  <a href={file.url} target="_blank" rel="noopener noreferrer" style={{ color: "#008060", fontSize: "12px", textDecoration: "underline", wordBreak: "break-all" }}>
                                    {file.url}
                                  </a>
                                </td>
                                <td style={{ textAlign: "center" }}>
                                  <input 
                                    type="checkbox" 
                                    checked={file.embed || false} 
                                    disabled={!file.selected}
                                    onChange={(e) => setReviewFileLinks(prev => prev.map((f, i) => i === idx ? { ...f, embed: e.target.checked } : f))} 
                                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Part 4: Options & Variants list */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>
                    Variants &amp; Options
                  </h3>
                  {reviewOptions.length === 0 && (
                    <button
                      onClick={handleEnableVariants}
                      style={{
                        border: "1px solid #008060",
                        background: "transparent",
                        color: "#008060",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                    >
                      Enable Options &amp; Variants
                    </button>
                  )}
                </div>

                {reviewOptions.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {/* Option definitions */}
                    <div style={{ background: "#f6f6f7", padding: "16px", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#303030" }}>Configure Options</h4>
                        <button
                          onClick={handleAddOption}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#008060",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                          }}
                        >
                          + Add Option Type
                        </button>
                      </div>
                      
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {reviewOptions.map((opt, idx) => (
                          <div key={idx} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                            <div style={{ width: "30%" }}>
                              <input
                                type="text"
                                className="review-input"
                                placeholder="Option Name (e.g. Size)"
                                value={opt.name}
                                onChange={(e) => handleUpdateOptionName(idx, e.target.value)}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                className="review-input"
                                placeholder="Values (comma separated, e.g. S, M, L)"
                                value={reviewOptionsText[idx] || ""}
                                onChange={(e) => handleOptionValuesChange(idx, e.target.value)}
                              />
                            </div>
                            <button
                              onClick={() => handleRemoveOption(idx)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "#bf0711",
                                cursor: "pointer",
                                fontSize: "18px",
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Variants matrix */}
                    <div>
                      <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 600, color: "#303030" }}>Variants Matrix ({reviewVariants.length})</h4>
                      <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
                        <table className="review-table">
                          <thead>
                            <tr>
                              <th style={{ width: "80px", textAlign: "center" }}>Active?</th>
                              <th>Variant</th>
                              <th>SKU</th>
                              {reviewPurchaseType !== "quote_only" && <th>Price</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {reviewVariants.map((v) => (
                              <tr key={v.id} style={{ opacity: v.selected ? 1 : 0.6 }}>
                                <td style={{ textAlign: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={v.selected}
                                    onChange={(e) => handleToggleVariant(v.id, e.target.checked)}
                                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                                  />
                                </td>
                                <td>
                                  <span style={{ fontWeight: 500 }}>
                                    {v.optionValues.map(ov => ov.name).join(" / ")}
                                  </span>
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="review-input"
                                    value={v.sku}
                                    onChange={(e) => handleUpdateVariantSku(v.id, e.target.value)}
                                  />
                                </td>
                                {reviewPurchaseType !== "quote_only" && (
                                  <td>
                                    <input
                                      type="text"
                                      className="review-input"
                                      value={v.price}
                                      onChange={(e) => handleUpdateVariantPrice(v.id, e.target.value)}
                                    />
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {reviewOptions.length === 0 && (
                  <p style={{ margin: 0, fontSize: "13px", color: "#6d7175", fontStyle: "italic" }}>
                    Standard product with no variants.
                  </p>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div style={{
              padding: "16px 24px",
              borderTop: "1px solid #e1e3e5",
              background: "#fafbfb",
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
            }}>
              <button
                onClick={() => setIsReviewOpen(false)}
                disabled={isPublishing}
                style={{
                  border: "1px solid #c9cccf",
                  background: "#ffffff",
                  color: "#1a1c1d",
                  padding: "10px 18px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={isPublishing}
                style={{
                  border: "none",
                  background: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                  color: "#ffffff",
                  padding: "10px 18px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
              >
                {isPublishing ? (
                  <>
                    <s-spinner size="small" accessibility-label="Publishing..."></s-spinner>
                    Publishing...
                  </>
                ) : (
                  "Publish to Shopify as Draft"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
