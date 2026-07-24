import React, { useState, useEffect } from "react";
import type {
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
  status: "queued" | "converting" | "ready" | "failed" | "publishing";
  markdown: string;
  error?: string;
  domain?: string;
  extractedData?: any;
  existingProductId?: string;
  collections?: string[];
  overwriteOptions?: {
    title: boolean;
    description: boolean;
    variants: boolean;
  };
  size?: string;
}


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Ping Python Flask service
  let pythonServiceStatus = "offline";
  try {
    const markitdownUrl = process.env.MARKITDOWN_SERVICE_URL || "http://localhost:5005";
    const response = await fetch(`${markitdownUrl}/health`, { 
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

export const action = async () => {
  return null;
};

export default function Index() {
  const { storeName, pythonServiceStatus } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [isSessionLoaded, setIsSessionLoaded] = useState(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [throttleDelay, setThrottleDelay] = useState(3000);

  const [existingProductsMap, setExistingProductsMap] = useState<Record<string, { id: string; title: string; updatedAt: string; description: string; variants: any[] }>>({});
  const [queuedSources, setQueuedSources] = useState<QueuedSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMultiProduct, setIsMultiProduct] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<Record<string, number>>({});
  const [urlFavicon, setUrlFavicon] = useState<string | null>(null);
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const terminalEndRef = React.useRef<HTMLDivElement>(null);
  const [showSplitPreview, setShowSplitPreview] = useState(true);

  React.useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [crawlLogs]);

  // Editable markdown content
  const [editingMarkdown, setEditingMarkdown] = useState("");

  const selectedSource = queuedSources.find(s => s.id === selectedSourceId);
  const existingProduct = selectedSource ? existingProductsMap[selectedSource.name] : undefined;

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
    const sizeStr = file.size > 1024 * 1024 
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` 
      : `${(file.size / 1024).toFixed(0)} KB`;

    const sourceId = Math.random().toString(36).substring(7);
    const newSource: QueuedSource = {
      id: sourceId,
      name: file.name,
      type: "file",
      status: "converting",
      markdown: "",
      size: sizeStr,
    };
    setQueuedSources(prev => [...prev, newSource]);
    
    // Simulate upload & conversion progress bar
    setConversionProgress(prev => ({ ...prev, [sourceId]: 10 }));
    const progressInterval = setInterval(() => {
      setConversionProgress(prev => {
        const current = prev[sourceId] || 10;
        if (current >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return { ...prev, [sourceId]: current + Math.floor(Math.random() * 15) + 5 };
      });
    }, 400);

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/upload", { 
        method: "POST", 
        body: formData 
      });
      const data = await res.json();
      
      clearInterval(progressInterval);
      setConversionProgress(prev => ({ ...prev, [sourceId]: 100 }));
      
      setTimeout(() => {
        setConversionProgress(prev => {
          const next = { ...prev };
          delete next[sourceId];
          return next;
        });
      }, 1000);

      if (data.success) {
        setQueuedSources(prev => 
          prev.map(s => s.id === sourceId 
            ? { ...s, status: "ready", markdown: data.markdown } 
            : s
          )
        );
        setSelectedSourceId(sourceId);
      } else {
        setQueuedSources(prev => 
          prev.map(s => s.id === sourceId 
            ? { ...s, status: "failed", error: data.error } 
            : s
          )
        );
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setConversionProgress(prev => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
      setQueuedSources(prev => 
        prev.map(s => s.id === sourceId 
          ? { ...s, status: "failed", error: err.message } 
          : s
        )
      );
    }
  };

  const handleUrlInputChange = (val: string) => {
    setUrlInput(val);
    if (!val) {
      setUrlFavicon(null);
      setUrlValidationError(null);
      return;
    }
    
    try {
      const url = new URL(val);
      if (url.protocol === "http:" || url.protocol === "https:") {
        setUrlFavicon(`https://www.google.com/s2/favicons?sz=64&domain=${url.hostname}`);
        setUrlValidationError(null);
      } else {
        setUrlFavicon(null);
        setUrlValidationError("URL must start with http:// or https://");
      }
    } catch (_) {
      setUrlFavicon(null);
      if (val.includes(".") && val.length > 8) {
        setUrlValidationError("Please enter a valid URL (e.g., https://example.com/product)");
      } else {
        setUrlValidationError(null);
      }
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput || urlValidationError) return;

    const newSource: QueuedSource = {
      id: Math.random().toString(36).substring(7),
      name: urlInput,
      type: "url",
      status: "converting",
      markdown: "",
    };
    setQueuedSources(prev => [...prev, newSource]);
    setUrlInput("");
    setUrlFavicon(null);
    setUrlValidationError(null);
    setActiveTab("queue");

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

  // Shopify Metafield Mapping States
  const [existingMetafields, setExistingMetafields] = useState<any[]>([]);
  const [metafieldMappings, setMetafieldMappings] = useState<Record<string, string>>({});
  const [isCreatingMetafield, setIsCreatingMetafield] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchMetafieldDefinitions = async () => {
      try {
        const res = await fetch("/api/metafields");
        const data = await res.json();
        if (data.success && data.definitions) {
          setExistingMetafields(data.definitions);
        }
      } catch (e) {
        console.error("Failed to fetch metafield definitions", e);
      }
    };
    fetchMetafieldDefinitions();
  }, []);

  // Website Crawling & Structure Selection States
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState("");
  const [profileRootUrlInput, setProfileRootUrlInput] = useState("");
  const [profileProductPatternInput, setProfileProductPatternInput] = useState("");
  const [profileCategoryPatternInput, setProfileCategoryPatternInput] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDetectingPatterns, setIsDetectingPatterns] = useState(false);
  const [detectedCategoryExample, setDetectedCategoryExample] = useState("");
  const [detectedProductExample, setDetectedProductExample] = useState("");
  
  const [profileSampleUrl, setProfileSampleUrl] = useState("");
  const [isGeneratingSchema, setIsGeneratingSchema] = useState(false);
  const [schemaCandidates, setSchemaCandidates] = useState<any[]>([]);
  const [schemaProductResult, setSchemaProductResult] = useState<any>(null);
  const [schemaRules, setSchemaRules] = useState<any>(null);

  const [crawlUrlInput, setCrawlUrlInput] = useState("");
  const [customProductPattern, setCustomProductPattern] = useState("");
  const [customCategoryPattern, setCustomCategoryPattern] = useState("");

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const res = await fetch("/api/profiles");
        const data = await res.json();
        if (data.success && data.profiles) {
          setProfiles(data.profiles);
          if (data.profiles.length > 0) {
            const first = data.profiles[0];
            setSelectedProfileId(first.id);
            setCrawlUrlInput(first.rootUrl);
            setCustomProductPattern(first.productPattern);
            setCustomCategoryPattern(first.categoryPattern);

            // Load isolated session
            const saved = localStorage.getItem(`ingest_ai_session_${first.id}`);
            if (saved) {
              const parsed = JSON.parse(saved);
              const resetSources = (parsed.queuedSources || []).map((s: any) => {
                if (s.status === "converting") return { ...s, status: "queued" };
                if (s.status === "publishing") return { ...s, status: "ready" };
                return s;
              });
              setQueuedSources(resetSources);
              setCrawlResult(parsed.crawlResult || null);
              setCustomCollections(parsed.customCollections || []);
              setSelectedSourceId(parsed.selectedSourceId || null);
              setMetafieldMappings(parsed.metafieldMappings || {});
            }
          } else {
            // Fallback to legacy global session if present, otherwise global fallback
            const saved = localStorage.getItem("ingest_ai_session_global") || localStorage.getItem("ingest_ai_session");
            if (saved) {
              const parsed = JSON.parse(saved);
              const resetSources = (parsed.queuedSources || []).map((s: any) => {
                if (s.status === "converting") return { ...s, status: "queued" };
                if (s.status === "publishing") return { ...s, status: "ready" };
                return s;
              });
              setQueuedSources(resetSources);
              setCrawlResult(parsed.crawlResult || null);
              setCustomCollections(parsed.customCollections || []);
              setSelectedSourceId(parsed.selectedSourceId || null);
              setMetafieldMappings(parsed.metafieldMappings || {});
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch profiles", e);
      } finally {
        setIsSessionLoaded(true);
      }
    };
    fetchProfiles();
  }, []);

  const handleSelectProfile = (id: string | null) => {
    // 1. Save current session to the previous key
    const prevKey = selectedProfileId 
      ? `ingest_ai_session_${selectedProfileId}` 
      : "ingest_ai_session_global";
    const currentSession = { queuedSources, crawlResult, customCollections, selectedSourceId, metafieldMappings };
    localStorage.setItem(prevKey, JSON.stringify(currentSession));

    // 2. Switch selectedProfileId
    setSelectedProfileId(id);
    
    // Clear schema state
    setProfileSampleUrl("");
    setSchemaProductResult(null);
    setSchemaRules(null);
    setSchemaCandidates([]);

    // 3. Load from new key
    const newKey = id 
      ? `ingest_ai_session_${id}` 
      : "ingest_ai_session_global";
    
    const saved = localStorage.getItem(newKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const resetSources = (parsed.queuedSources || []).map((s: any) => {
          if (s.status === "converting") return { ...s, status: "queued" };
          if (s.status === "publishing") return { ...s, status: "ready" };
          return s;
        });
        setQueuedSources(resetSources);
        setCrawlResult(parsed.crawlResult || null);
        setCustomCollections(parsed.customCollections || []);
        setSelectedSourceId(parsed.selectedSourceId || null);
        setMetafieldMappings(parsed.metafieldMappings || {});
      } catch (e) {
        console.error("Failed to parse saved session", e);
      }
    } else {
      setQueuedSources([]);
      setCrawlResult(null);
      setCustomCollections([]);
      setSelectedSourceId(null);
      setMetafieldMappings({});
    }

    // 4. Update inputs based on the selected profile
    if (id) {
      const profile = profiles.find(p => p.id === id);
      if (profile) {
        setCrawlUrlInput(profile.rootUrl);
        setCustomProductPattern(profile.productPattern);
        setCustomCategoryPattern(profile.categoryPattern);
      }
    } else {
      setCrawlUrlInput("");
      setCustomProductPattern("");
      setCustomCategoryPattern("");
    }
  };

  const handleCreateMetafieldDefinition = async (attrName: string) => {
    const cleanAttr = attrName.trim();
    const key = cleanAttr
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/__+/g, "_")
      .replace(/^_+|_+$/g, "");
      
    const activeProfile = profiles.find(p => p.id === selectedProfileId);
    let platform = "Shopify";
    if (activeProfile) {
      if (activeProfile.categoryPattern.includes("product-category") || activeProfile.rootUrl.includes("woocommerce")) {
        platform = "WooCommerce";
      }
    }
    const finalKey = platform === "WooCommerce" ? `pa_${key}` : key;

    setIsCreatingMetafield(prev => ({ ...prev, [attrName]: true }));
    try {
      const res = await fetch("/api/metafields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanAttr,
          namespace: "custom",
          key: finalKey,
          type: "single_line_text_field",
        }),
      });
      const data = await res.json();
      if (data.success && data.definition) {
        setExistingMetafields(prev => [...prev, data.definition]);
        setMetafieldMappings(prev => ({
          ...prev,
          [attrName]: `${data.definition.namespace}.${data.definition.key}`,
        }));
        shopify.toast.show(`Created metafield definition custom.${finalKey}`);
      } else {
        shopify.toast.show(`Error: ${data.error || "Failed to create metafield"}`);
      }
    } catch (err: any) {
      shopify.toast.show(`Network error: ${err.message}`);
    } finally {
      setIsCreatingMetafield(prev => ({ ...prev, [attrName]: false }));
    }
  };

  const handleAutoDetectPatterns = async () => {
    if (!profileRootUrlInput.trim()) {
      shopify.toast.show("Please enter a Root Website URL first");
      return;
    }
    setIsDetectingPatterns(true);
    shopify.toast.show("Detecting patterns from sitemap...");
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: profileRootUrlInput }),
      });
      const data = await res.json();
      const categoryUrls: string[] = (data.categories || []).map((c: any) => c.url).filter(Boolean);
      const productUrls: string[] = (data.categories || []).flatMap((c: any) => (c.products || []).map((p: any) => p.url)).filter(Boolean);

      if (categoryUrls.length > 0) {
        const randomIndex = Math.floor(Math.random() * Math.min(categoryUrls.length, 5));
        const sampleCatUrlStr = categoryUrls[randomIndex] || categoryUrls[0];
        try {
          const catUrl = new URL(sampleCatUrlStr);
          let path = catUrl.pathname;
          if (path.includes("/collections/")) {
             setProfileCategoryPatternInput("/collections/");
          } else {
             const parts = path.split('/').filter(Boolean);
             if (parts.length > 0) setProfileCategoryPatternInput("/" + parts[0] + "/");
          }
          setDetectedCategoryExample(sampleCatUrlStr);
        } catch (_) {}
      }

      if (productUrls.length > 0) {
        const randomIndex = Math.floor(Math.random() * Math.min(productUrls.length, 10));
        const sampleProdUrlStr = productUrls[randomIndex] || productUrls[0];
        try {
          const prodUrl = new URL(sampleProdUrlStr);
          let path = prodUrl.pathname;
          if (path.includes("/products/")) {
             setProfileProductPatternInput("/products/");
          } else {
             const parts = path.split('/').filter(Boolean);
             if (parts.length > 0) setProfileProductPatternInput("/" + parts[0] + "/");
          }
          setDetectedProductExample(sampleProdUrlStr);
          // Auto-fill Sample Product URL for blueprint schema generator
          setProfileSampleUrl(sampleProdUrlStr);
        } catch (_) {}
      }

      shopify.toast.show("Pattern detection complete & sample URL populated!");
    } catch (e: any) {
      shopify.toast.show(`Auto-detect failed: ${e.message}`);
    } finally {
      setIsDetectingPatterns(false);
    }
  };

  const handleGenerateSchema = async () => {
    if (!profileSampleUrl.trim()) {
      shopify.toast.show("Please enter a Sample Product URL");
      return;
    }
    setIsGeneratingSchema(true);
    shopify.toast.show("Analyzing page and building extraction blueprint...");
    try {
      const res = await fetch("/api/generate-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: profileSampleUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setSchemaProductResult(data.product);
        setSchemaRules(data.extraction_rules);
        setSchemaCandidates(data.candidates || []);
        shopify.toast.show("Blueprint generated successfully!");
      } else {
        shopify.toast.show(`Failed: ${data.error}`);
      }
    } catch (e: any) {
      shopify.toast.show(`Error: ${e.message}`);
    } finally {
      setIsGeneratingSchema(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileNameInput.trim() || !profileRootUrlInput.trim()) {
      shopify.toast.show("Profile Name and Website URL are required");
      return;
    }

    setIsSavingProfile(true);
    try {
      const isEdit = isEditingProfile && selectedProfileId;
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isEdit ? "update" : "create",
          id: selectedProfileId,
          name: profileNameInput.trim(),
          rootUrl: profileRootUrlInput.trim(),
          productPattern: profileProductPatternInput.trim(),
          categoryPattern: profileCategoryPatternInput.trim(),
          extractionRules: schemaRules ? JSON.stringify(schemaRules) : undefined
        }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        shopify.toast.show(isEdit ? "Profile updated successfully" : "Profile created successfully");
        
        setProfiles(prev => {
          if (isEdit) {
            return prev.map(p => p.id === selectedProfileId ? data.profile : p);
          } else {
            return [data.profile, ...prev];
          }
        });

        setSelectedProfileId(data.profile.id);
        setCrawlUrlInput(data.profile.rootUrl);
        setCustomProductPattern(data.profile.productPattern);
        setCustomCategoryPattern(data.profile.categoryPattern);

        setIsEditingProfile(false);
        setIsCreatingProfile(false);
      } else {
        shopify.toast.show(`Failed to save profile: ${data.error || "Unknown error"}`);
      }
    } catch (e: any) {
      shopify.toast.show(`Error saving profile: ${e.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!confirm("Are you sure you want to delete this website profile?")) return;

    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (data.success) {
        shopify.toast.show("Profile deleted successfully");
        setProfiles(prev => prev.filter(p => p.id !== id));
        
        if (selectedProfileId === id) {
          setSelectedProfileId(null);
          setCrawlUrlInput("");
          setCustomProductPattern("");
          setCustomCategoryPattern("");
        }
      } else {
        shopify.toast.show(`Failed to delete profile: ${data.error || "Unknown error"}`);
      }
    } catch (e: any) {
      shopify.toast.show(`Error deleting profile: ${e.message}`);
    }
  };

  const startCreatingProfile = () => {
    setIsCreatingProfile(true);
    setIsEditingProfile(false);
    setProfileNameInput("");
    setProfileRootUrlInput("");
    setProfileProductPatternInput("");
    setProfileCategoryPatternInput("");
  };

  const startEditingProfile = () => {
    if (!selectedProfileId) return;
    const profile = profiles.find(p => p.id === selectedProfileId);
    if (!profile) return;
    setIsEditingProfile(true);
    setIsCreatingProfile(false);
    setProfileNameInput(profile.name);
    setProfileRootUrlInput(profile.rootUrl);
    setProfileProductPatternInput(profile.productPattern);
    setProfileCategoryPatternInput(profile.categoryPattern);
  };
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<any | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"ingest" | "crawl" | "queue">("ingest");
  const [previewSubTab, setPreviewSubTab] = useState<"markdown" | "schema">("schema");
  
  const [globalOverwriteTitle] = useState(true);
  const [globalOverwriteDescription] = useState(true);
  const [globalOverwriteVariants] = useState(true);

  const handleSingleProductUrlRoute = async (targetUrl: string) => {
    const newSource: QueuedSource = {
      id: Math.random().toString(36).substring(7),
      name: targetUrl,
      type: "url",
      status: "converting",
      markdown: "",
    };
    setQueuedSources(prev => [...prev, newSource]);
    setUrlInput("");
    setUrlFavicon(null);
    setUrlValidationError(null);
    setActiveTab("queue");

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

  const handleCrawlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrlInput) return;

    // Check if the input URL is a product page and should auto-route to Single Product URL Mode
    const isCustomProduct = customProductPattern && crawlUrlInput.toLowerCase().includes(customProductPattern.toLowerCase());
    const isDefaultProduct = /\/(product|products|item|p|pd)\//i.test(crawlUrlInput);

    if (isCustomProduct || isDefaultProduct) {
      handleSingleProductUrlRoute(crawlUrlInput);
      return;
    }

    setIsCrawling(true);
    setCrawlResult(null);
    setExpandedCategories({});
    setSelectedProducts([]);

    // Start with initial system log
    setCrawlLogs([`[System] Initializing crawler for domain: ${new URL(crawlUrlInput).hostname}`]);
    
    let tempLogIdx = 0;
    const tempLogs = [
      "[System] Establishing secure HTTP connection to vendor site...",
      "[Robots] Downloading robots.txt to inspect crawl instructions...",
      "[Sitemap] Looking for XML sitemaps to build structure...",
      "[Crawler] Resolving catalog URL structures (scraping sitemaps/homepage)..."
    ];
    
    // Simulate initial loading while request is active
    const logInterval = setInterval(() => {
      if (tempLogIdx < tempLogs.length) {
        setCrawlLogs(prev => [...prev, tempLogs[tempLogIdx]]);
        tempLogIdx++;
      }
    }, 1500);

    const patterns: Record<string, string[]> = {};
    if (customProductPattern.trim()) {
      patterns.product = [customProductPattern.trim()];
    }
    if (customCategoryPattern.trim()) {
      patterns.category = [customCategoryPattern.trim()];
    }

    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: crawlUrlInput,
          patterns: Object.keys(patterns).length > 0 ? patterns : undefined
        }),
      });
      const data = await res.json();

      clearInterval(logInterval);

      // Play back actual backend logs dynamically
      const backendLogs = data.logs || [
        `[System] Initializing crawler for domain: ${new URL(crawlUrlInput).hostname}`,
        `[System] Scraped site structure.`,
        data.success ? `[System] Crawl finished successfully.` : `[Error] Crawl failed.`
      ];

      // Quick playback animation
      let animIdx = 0;
      setCrawlLogs([backendLogs[0]]);
      const animInterval = setInterval(() => {
        if (animIdx < backendLogs.length - 1) {
          animIdx++;
          setCrawlLogs(prev => [...prev, backendLogs[animIdx]]);
        } else {
          clearInterval(animInterval);
        }
      }, 80);

      if (data.success) {
        const sanitized = sanitizeCrawlResult(data);
        setCrawlResult(sanitized);
        
        const defaultExpanded: Record<string, boolean> = {};
        sanitized.categories.forEach((cat: any) => {
          defaultExpanded[cat.name] = true;
        });
        setExpandedCategories(defaultExpanded);
        setActiveTab("crawl");

        try {
          const domain = new URL(crawlUrlInput).hostname;
          const checkRes = await fetch("/api/check-existing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain }),
          });
          const checkData = await checkRes.json();
          if (checkData.success && checkData.existingProducts) {
            setExistingProductsMap(checkData.existingProducts);
          }
        } catch (e) {
          console.error("Failed to check existing products", e);
        }

        // Run grouping immediately if groupSimilar is true, otherwise initialize with standalone path keys
        if (groupSimilar) {
          await performGroupingForData(sanitized, shopifyCollections);
        } else {
          const allStandaloneKeys: string[] = [];
          sanitized.categories.forEach((cat: any) => {
            (cat.products || []).forEach((p: any, prodIdx: number) => {
              allStandaloneKeys.push(`${cat.name}::standalone::${prodIdx}`);
            });
          });
          setSelectedProducts(allStandaloneKeys);
        }
      } else {
        shopify.toast.show(`Crawling failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      clearInterval(logInterval);
      setCrawlLogs(prev => [...prev, `[Error] Connection error: ${err.message}`]);
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

  const handleCategorySelectToggle = (catName: string, groups: any[], checked: boolean) => {
    const catKeys: string[] = [];
    if (groupSimilar) {
      groups.forEach((group: any, groupIdx: number) => {
        group.variants.forEach((v: any, variantIdx: number) => {
          catKeys.push(`${catName}::grouped::${groupIdx}::${variantIdx}`);
        });
      });
    } else {
      let flatIdx = 0;
      groups.forEach((group: any) => {
        group.variants.forEach((v: any) => {
          catKeys.push(`${catName}::standalone::${flatIdx}`);
          flatIdx++;
        });
      });
    }
    
    if (checked) {
      setSelectedProducts(prev => {
        const next = [...prev];
        catKeys.forEach((key: string) => {
          if (!next.includes(key)) next.push(key);
        });
        return next;
      });
    } else {
      setSelectedProducts(prev => prev.filter(key => !catKeys.includes(key)));
    }
  };

  const handleProductSelectToggle = (key: string) => {
    setSelectedProducts(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
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

  const handleQueueSelected = (customOverrides?: Record<string, string>) => {
    if (!crawlResult) return;

    const newSources: QueuedSource[] = [];
    const addedUrls = new Set<string>();
    const overrides = customOverrides || groupCollectionOverride;

    if (groupSimilar) {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        groups.forEach((group: any, groupIdx: number) => {
          group.variants.forEach((variant: any, variantIdx: number) => {
            const key = `${catName}::grouped::${groupIdx}::${variantIdx}`;
            if (selectedProducts.includes(key)) {
              if (addedUrls.has(variant.url)) return;
              addedUrls.add(variant.url);

              const existingInfo = existingProductsMap[variant.url];
              
              let collectionId: string | undefined = undefined;
              if (overrides[variant.name]) {
                collectionId = overrides[variant.name];
              } else if (overrides[group.title]) {
                collectionId = overrides[group.title];
              } else if (group.collection_match) {
                collectionId = group.collection_match.id;
              } else if (catName !== "Unmatched Products") {
                const existingCol = shopifyCollections.find(c => c.title.toLowerCase() === catName.toLowerCase());
                if (existingCol) collectionId = existingCol.id;
              }

              newSources.push({
                id: Math.random().toString(36).substring(7),
                name: variant.url,
                type: "url",
                status: "queued",
                markdown: "",
                domain: crawlResult.domain,
                existingProductId: existingInfo?.id,
                collections: collectionId ? [collectionId] : [],
                overwriteOptions: existingInfo ? {
                  title: globalOverwriteTitle,
                  description: globalOverwriteDescription,
                  variants: globalOverwriteVariants
                } : undefined
              });
            }
          });
        });
      });
    } else {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        groups.flatMap((g: any) => g.variants).forEach((prod: any, prodIdx: number) => {
          const key = `${catName}::standalone::${prodIdx}`;
          if (selectedProducts.includes(key)) {
            if (addedUrls.has(prod.url)) return;
            addedUrls.add(prod.url);

            const existingInfo = existingProductsMap[prod.url];
            
            let collectionId: string | undefined = undefined;
            if (overrides[prod.name]) {
              collectionId = overrides[prod.name];
            } else if (catName !== "Unmatched Products") {
              const existingCol = shopifyCollections.find(c => c.title.toLowerCase() === catName.toLowerCase());
              if (existingCol) collectionId = existingCol.id;
            }

            newSources.push({
              id: Math.random().toString(36).substring(7),
              name: prod.url,
              type: "url",
              status: "queued",
              markdown: "",
              domain: crawlResult.domain,
              existingProductId: existingInfo?.id,
              collections: collectionId ? [collectionId] : [],
              overwriteOptions: existingInfo ? {
                title: globalOverwriteTitle,
                description: globalOverwriteDescription,
                variants: globalOverwriteVariants
              } : undefined
            });
          }
        });
      });
    }

    if (newSources.length === 0) return;

    setQueuedSources(prev => {
      const existingNames = prev.map(s => s.name);
      const uniqueNew = newSources.filter(s => !existingNames.includes(s.name));
      return [...prev, ...uniqueNew];
    });

    setActiveTab("queue");
    shopify.toast.show(`Queued ${newSources.length} products successfully!`);
  };

  const handleExportQueue = () => {
    if (queuedSources.length === 0) {
      shopify.toast.show("Queue is empty, nothing to export!");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(queuedSources, null, 2));
    const downloadAnchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ingest-queue-${timestamp}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    shopify.toast.show("Queue exported successfully!");
  };

  const handleBulkImportAndCreateCategories = async () => {
    if (!crawlResult) return;

    const titlesToCreate = new Set<string>();
    const collectionIdMap: Record<string, string> = {};

    const shopifyCollectionsMap: Record<string, string> = {};
    shopifyCollections.forEach(c => {
      shopifyCollectionsMap[c.title.toLowerCase()] = c.id;
    });

    if (groupSimilar) {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        groups.forEach((group: any, groupIdx: number) => {
          const hasSelected = group.variants.some((v: any, variantIdx: number) =>
            selectedProducts.includes(`${catName}::grouped::${groupIdx}::${variantIdx}`)
          );
          if (hasSelected) {
            const overrideId = groupCollectionOverride[group.title];
            if (overrideId) {
              if (overrideId.startsWith("custom_")) {
                const customCol = customCollections.find(c => c.id === overrideId);
                if (customCol) {
                  const existingId = shopifyCollectionsMap[customCol.title.toLowerCase()];
                  if (existingId) {
                    collectionIdMap[overrideId] = existingId;
                  } else {
                    titlesToCreate.add(customCol.title);
                  }
                }
              } else if (overrideId.startsWith("gid://shopify/Collection/")) {
                collectionIdMap[overrideId] = overrideId;
              }
            } else if (group.collection_match) {
              collectionIdMap[group.title] = group.collection_match.id;
            } else if (catName !== "Unmatched Products") {
              const existingId = shopifyCollectionsMap[catName.toLowerCase()];
              if (existingId) {
                collectionIdMap[catName] = existingId;
              } else {
                titlesToCreate.add(catName);
              }
            }
          }
        });
      });
    } else {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        let hasSelected = false;
        groups.flatMap((g: any) => g.variants).forEach((p: any, prodIdx: number) => {
          const key = `${catName}::standalone::${prodIdx}`;
          if (selectedProducts.includes(key)) {
            hasSelected = true;
          }
        });
        if (hasSelected && catName !== "Unmatched Products") {
          const existingId = shopifyCollectionsMap[catName.toLowerCase()];
          if (existingId) {
            collectionIdMap[catName] = existingId;
          } else {
            titlesToCreate.add(catName);
          }
        }
      });
    }

    if (titlesToCreate.size === 0 && Object.keys(collectionIdMap).length === 0 && selectedProducts.length === 0) {
      shopify.toast.show("No products selected!");
      return;
    }

    const newCollectionsList: any[] = [];
    if (titlesToCreate.size > 0) {
      shopify.toast.show(`Creating ${titlesToCreate.size} new collections...`);
      for (const title of titlesToCreate) {
        try {
          const res = await fetch("/api/collections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title })
          });
          const data = await res.json();
          if (data.success && data.collection) {
            collectionIdMap[title] = data.collection.id;
            newCollectionsList.push({
              id: data.collection.id,
              title: data.collection.title,
              handle: data.collection.handle,
              productsCount: 0
            });
          } else {
            console.error("Failed to create collection", title, data.error);
          }
        } catch (err) {
          console.error("Failed to create collection", title, err);
        }
      }
      if (newCollectionsList.length > 0) {
        setShopifyCollections(prev => [...prev, ...newCollectionsList]);
      }
    }

    const newOverrides = { ...groupCollectionOverride };
    if (groupSimilar) {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        groups.forEach((group: any, groupIdx: number) => {
          const hasSelected = group.variants.some((v: any, variantIdx: number) =>
            selectedProducts.includes(`${catName}::grouped::${groupIdx}::${variantIdx}`)
          );
          if (hasSelected) {
            const overrideId = groupCollectionOverride[group.title];
            let finalId: string | undefined = undefined;
            if (overrideId) {
              if (overrideId.startsWith("custom_")) {
                const customCol = customCollections.find(c => c.id === overrideId);
                if (customCol) {
                  finalId = collectionIdMap[customCol.title] || collectionIdMap[overrideId];
                }
              } else {
                finalId = overrideId;
              }
            } else if (group.collection_match) {
              finalId = group.collection_match.id;
            } else if (catName !== "Unmatched Products") {
              finalId = collectionIdMap[catName];
            }

            if (finalId) {
              group.variants.forEach((v: any) => {
                newOverrides[v.name] = finalId;
              });
            }
          }
        });
      });
    } else {
      Object.entries(groupedCategories).forEach(([catName, groups]) => {
        const finalId = collectionIdMap[catName];
        if (finalId) {
          groups.flatMap((g: any) => g.variants).forEach((p: any, prodIdx: number) => {
            const key = `${catName}::standalone::${prodIdx}`;
            if (selectedProducts.includes(key)) {
              newOverrides[p.name] = finalId;
            }
          });
        }
      });
    }

    setGroupCollectionOverride(newOverrides);

    // Queue selected products with resolved collections overrides
    handleQueueSelected(newOverrides);

    setIsProcessingQueue(true);
    setIsAutoPublishing(true);
    setActiveTab("queue");
    shopify.toast.show("Bulk operation started! Sit back and relax.");
  };

  // Grouping & Extraction States
  const [groupSimilar, setGroupSimilar] = useState(true);
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
  const [reviewOverwriteTitle, setReviewOverwriteTitle] = useState(true);
  const [reviewOverwriteDescription, setReviewOverwriteDescription] = useState(true);
  const [reviewOverwriteVariants, setReviewOverwriteVariants] = useState(true);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isAutoPublishing, setIsAutoPublishing] = useState(false);
  const [manualPublishCount, setManualPublishCount] = useState(0);
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
  const [reviewHeroImageIdx, setReviewHeroImageIdx] = useState<number>(0);
  const [reviewFileLinks, setReviewFileLinks] = useState<{ url: string; text: string; selected: boolean; embed?: boolean }[]>([]);
  const [reviewCurrency, setReviewCurrency] = useState("USD");
  const [reviewPriceUnit, setReviewPriceUnit] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [activeIngestMethod, setActiveIngestMethod] = useState<"single_url" | "document" | "website_crawl">("website_crawl");

  const sanitizeCrawlResult = (data: any) => {
    if (!data || !data.categories) return data;
    return {
      ...data,
      categories: data.categories.map((cat: any) => ({
        ...cat,
        products: (cat.products || []).map((p: any, idx: number) => ({
          ...p,
          id: p.id || `${cat.name}::${idx}::${p.url || p.name}`
        }))
      }))
    };
  };

  const performGroupingForData = async (crawlData: any, currentCollections: any[]) => {
    setIsGrouping(true);
    const newGroupedCats: Record<string, any[]> = {};
    const totalStats = { total: 0, matched: 0, new: 0 };

    try {
      let collections = currentCollections;
      if (collections.length === 0) {
        try {
          const colRes = await fetch("/api/collections");
          const colData = await colRes.json();
          if (colData.success && colData.collections) {
            setShopifyCollections(colData.collections);
            collections = colData.collections;
          }
        } catch (_) {
          /* ponytail: collections fetch failed — fall through with currentCollections */
        }
      }

      // 1. Flatten all products from all scraped categories
      const allProducts = crawlData.categories.flatMap((c: any) => c.products || []);

      if (allProducts.length === 0) {
        setGroupedCategories({});
        setGroupingStats({ total: 0, matched: 0, newCount: 0 });
        setIsGrouping(false);
        return;
      }

      try {
        // 2. Send in one massive batch
        const res = await fetch("/api/group-variants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products: allProducts, collections }),
        });
        const data = await res.json();
        
        const groupedResults = data.success ? data.grouped : allProducts.map((p: any) => ({
          title: p.name,
          is_grouped: false,
          variants: [p],
          collection_match: null,
        }));

        if (data.success && data.stats) {
          totalStats.total = data.stats.total;
          totalStats.matched = data.stats.matched;
          totalStats.new = data.stats.new;
        } else {
          totalStats.total = allProducts.length;
          totalStats.new = allProducts.length;
        }

        // 3. Distribute grouped results by collection_match (or "Unmatched Products")
        groupedResults.forEach((group: any) => {
          const catName = group.collection_match ? group.collection_match.title : "Unmatched Products";
          if (!newGroupedCats[catName]) {
            newGroupedCats[catName] = [];
          }
          newGroupedCats[catName].push(group);
        });

      } catch (innerErr) {
        console.error("Failed to group variants globally", innerErr);
        // Fallback: put everything in "Unmatched Products"
        newGroupedCats["Unmatched Products"] = allProducts.map((p: any) => ({
          title: p.name,
          is_grouped: false,
          variants: [p],
          collection_match: null,
        }));
        totalStats.total = allProducts.length;
        totalStats.new = allProducts.length;
      }

      setGroupedCategories(newGroupedCats);
      setGroupingStats({ total: totalStats.total, matched: totalStats.matched, newCount: totalStats.new });

      // Auto-select all grouped variants with path keys
      const allGroupedKeys: string[] = [];
      Object.entries(newGroupedCats).forEach(([catName, groups]) => {
        groups.forEach((group: any, groupIdx: number) => {
          group.variants.forEach((v: any, variantIdx: number) => {
            allGroupedKeys.push(`${catName}::grouped::${groupIdx}::${variantIdx}`);
          });
        });
      });
      setSelectedProducts(allGroupedKeys);
      setExpandedCategories(Object.keys(newGroupedCats).reduce((acc: any, key) => { acc[key] = true; return acc; }, {}));
      
    } catch (err) {
      console.error("Failed to perform grouping", err);
    } finally {
      setIsGrouping(false);
    }
  };

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

  const handleOpenReviewModal = (targetSourceId?: string) => {
    const sId = targetSourceId || selectedSourceId;
    if (targetSourceId && targetSourceId !== selectedSourceId) {
      setSelectedSourceId(targetSourceId);
    }

    const selectedSource = queuedSources.find(s => s.id === sId);
    const prod = (selectedSource?.extractedData) || extractedProduct;
    const mdContent = selectedSource?.markdown || editingMarkdown || "";
    
    const effectiveProd = prod || (mdContent ? parseMarkdownToProduct(mdContent) : null);
    if (!effectiveProd && !mdContent) return;

    const finalProd = effectiveProd || {
      title: selectedSource?.name || "Extracted Product",
      short_description: "",
      sku: "",
      price: "0.00",
      specifications: [],
      media_links: [],
      file_links: []
    };
    
    setExtractedProduct(finalProd);

    if (selectedSource?.overwriteOptions) {
      setReviewOverwriteTitle(selectedSource.overwriteOptions.title);
      setReviewOverwriteDescription(selectedSource.overwriteOptions.description);
      setReviewOverwriteVariants(selectedSource.overwriteOptions.variants);
    } else {
      setReviewOverwriteTitle(true);
      setReviewOverwriteDescription(true);
      setReviewOverwriteVariants(true);
    }

    setReviewTitle(finalProd.title || "");
    setReviewDescription(finalProd.short_description || finalProd.description || "");
    setReviewSku(finalProd.sku || "");
    setReviewPrice(finalProd.price || "0.00");
    setReviewCurrency(finalProd.currency || "USD");
    setReviewPriceUnit(finalProd.price_unit || "");
    setReviewPurchaseType(finalProd.purchase_type || "direct_buy");
    
    const specs = (finalProd.specifications || []).map((s: any) => ({
      name: s.name,
      value: s.displayValue || (s.value !== null && s.value !== undefined ? (s.unit ? `${s.value} ${s.unit}` : String(s.value)) : String(s.rawValue)),
      selected: true,
    }));
    setReviewSpecs(specs);

    const media = (finalProd.media_links || finalProd.images || []).map((m: any) => ({
      url: typeof m === "string" ? m : m.url,
      alt: typeof m === "string" ? "" : (m.alt || ""),
      selected: true,
    }));
    setReviewMediaLinks(media);
    setReviewHeroImageIdx(0);

    const files = (finalProd.file_links || []).map((f: any) => ({
      url: f.url,
      text: f.text || "",
      selected: true,
      embed: isHtmlViewerLink(f.url),
    }));
    setReviewFileLinks(files);
    
    const parsed = parseVariantsFromMarkdown(mdContent, finalProd.sku || "");
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
      const sortedMedia = [...reviewMediaLinks];
      if (reviewHeroImageIdx >= 0 && reviewHeroImageIdx < sortedMedia.length) {
        const hero = sortedMedia[reviewHeroImageIdx];
        sortedMedia.splice(reviewHeroImageIdx, 1);
        sortedMedia.unshift(hero);
      }

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
        media_links: sortedMedia.filter(m => m.selected).map(m => ({ url: m.url, alt: m.alt })),
        file_links: reviewFileLinks.filter(f => f.selected).map(f => ({ url: f.url, text: f.text, embed: f.embed })),
        
        existingProductId: queuedSources.find(s => s.id === selectedSourceId)?.existingProductId,
        sourceUrl: queuedSources.find(s => s.id === selectedSourceId)?.name,
        sourceDomain: queuedSources.find(s => s.id === selectedSourceId)?.domain,
        overwriteTitle: reviewOverwriteTitle,
        overwriteDescription: reviewOverwriteDescription,
        overwriteVariants: reviewOverwriteVariants,
        collections: queuedSources.find(s => s.id === selectedSourceId)?.collections || [],
        metafieldMappings,
      };
      
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      if (data.success) {
        setManualPublishCount(prev => prev + 1);
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

  useEffect(() => {
    if (!isAutoPublishing) return;

    const nextReady = queuedSources.find(s => s.status === "ready" && !s.name.startsWith("✓"));
    
    if (!nextReady) {
      if (queuedSources.some(s => s.status === "queued" || s.status === "converting")) {
        return; // wait for processing
      }
      setIsAutoPublishing(false);
      shopify.toast.show("Auto-publish complete!");
      return;
    }

    const currentlyPublishing = queuedSources.filter(s => s.status === "publishing").length;
    if (currentlyPublishing > 0) return;

    const publishNext = async () => {
      setQueuedSources(prev => prev.map(s => s.id === nextReady.id ? { ...s, status: "publishing" } : s));
      setSelectedSourceId(nextReady.id);
      
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdown: nextReady.markdown,
            domain: nextReady.domain,
            url: nextReady.type === "url" ? nextReady.name : undefined,
            profileId: selectedProfileId
          }),
        });
        const extractData = await res.json();

        if (extractData.success) {
           const productData = extractData.is_multi && extractData.products?.length > 0 ? extractData.products[0] : extractData;
           
           const payload: any = {
             title: productData.title,
             descriptionHtml: markdownToDescriptionHtml(productData.short_description || ""),
             sku: productData.sku,
             price: productData.price || "0.00",
             currency: productData.currency || "USD",
             price_unit: productData.price_unit,
             purchase_type: productData.purchase_type || "direct_buy",
             specifications: (productData.specifications || []).map((s: any) => ({
               name: s.name,
               value: s.displayValue || (s.value !== null && s.value !== undefined ? (s.unit ? `${s.value} ${s.unit}` : String(s.value)) : String(s.rawValue)),
             })),
             variants: productData.variants || [],
             options: productData.options || [],
             media_links: productData.media_links || [],
             file_links: productData.file_links || [],
             existingProductId: nextReady.existingProductId,
             sourceUrl: nextReady.name,
             sourceDomain: nextReady.domain,
             overwriteTitle: nextReady.overwriteOptions?.title ?? true,
             overwriteDescription: nextReady.overwriteOptions?.description ?? true,
             overwriteVariants: nextReady.overwriteOptions?.variants ?? true,
             collections: nextReady.collections || productData.collections || [],
             vendor: productData.vendor,
             metafieldMappings,
           };

           const pubRes = await fetch("/api/publish", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify(payload),
           });
           const pubData = await pubRes.json();

           if (pubData.success) {
             setQueuedSources(prev => prev.map(s => s.id === nextReady.id ? { ...s, name: `✓ ${s.name}`, status: "ready" } : s));
           } else {
             setQueuedSources(prev => prev.map(s => s.id === nextReady.id ? { ...s, status: "failed", error: pubData.error } : s));
           }
        } else {
          setQueuedSources(prev => prev.map(s => s.id === nextReady.id ? { ...s, status: "failed", error: extractData.error } : s));
        }
      } catch (err: any) {
        setQueuedSources(prev => prev.map(s => s.id === nextReady.id ? { ...s, status: "failed", error: err.message } : s));
      }
    };

    publishNext();
  }, [isAutoPublishing, queuedSources, crawlResult, groupCollectionOverride]);

  // --- Session Persistence & Queue Processing ---
  // The initial session loading is now handled inside the profiles fetch useEffect
  
  useEffect(() => {
    if (isSessionLoaded) {
      const activeKey = selectedProfileId 
        ? `ingest_ai_session_${selectedProfileId}` 
        : "ingest_ai_session_global";
      const session = { queuedSources, crawlResult, customCollections, selectedSourceId, metafieldMappings };
      localStorage.setItem(activeKey, JSON.stringify(session));
    }
  }, [queuedSources, crawlResult, customCollections, selectedSourceId, metafieldMappings, isSessionLoaded, selectedProfileId]);

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

    const processNext = async () => {
      setQueuedSources(prev => prev.map(s => s.id === nextSource.id ? { ...s, status: "converting" } : s));
      
      const randomDelay = throttleDelay + Math.floor(Math.random() * (throttleDelay * 0.8));
      await new Promise(r => setTimeout(r, randomDelay));
      
      triggerUrlIngestion(nextSource);
    };

    processNext();
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

  const handleGroupSimilarToggle = async (checked: boolean) => {
    setGroupSimilar(checked);
    if (!checked) {
      if (crawlResult) {
        const allStandaloneKeys: string[] = [];
        Object.entries(groupedCategories).forEach(([catName, groups]) => {
          let flatIdx = 0;
          groups.forEach((group: any) => {
            group.variants.forEach((v: any) => {
              allStandaloneKeys.push(`${catName}::standalone::${flatIdx}`);
              flatIdx++;
            });
          });
        });
        setSelectedProducts(allStandaloneKeys);
      }
      return;
    }
    if (!crawlResult) return;
    
    // Grouping is on, call our new flattened grouping logic
    await performGroupingForData(crawlResult, shopifyCollections);
  };

  const toggleGroupExpand = (groupTitle: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupTitle]: !prev[groupTitle]
    }));
  };

  const handleGroupSelectToggle = (categoryName: string, groupIdx: number, group: any, checked: boolean) => {
    const groupKeys: string[] = [];
    (group.variants || []).forEach((v: any, variantIdx: number) => {
      groupKeys.push(`${categoryName}::grouped::${groupIdx}::${variantIdx}`);
    });
    if (checked) {
      setSelectedProducts(prev => {
        const next = [...prev];
        groupKeys.forEach((key: string) => {
          if (!next.includes(key)) next.push(key);
        });
        return next;
      });
    } else {
      setSelectedProducts(prev => prev.filter(key => !groupKeys.includes(key)));
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
          url: selectedSource?.type === "url" ? selectedSource.name : undefined,
          profileId: selectedProfileId
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

  return (
    <s-page heading="Product Ingest AI" full-width style={{ width: "100%", maxWidth: "100%" }}>
      <style>{`
        :root {
          --pc-page-max-width: 100% !important;
        }
        .Polaris-Page, 
        [class*="Polaris-Page"], 
        s-page, 
        [full-width] {
          max-width: 100% !important;
          width: 100% !important;
        }
        .Polaris-Page__Content {
          max-width: 100% !important;
          padding-left: 24px !important;
          padding-right: 24px !important;
        }
      `}</style>
      <s-button 
        slot="primary-action" 
        onClick={handleExportQueue}
      >
        Export Queue
      </s-button>

      {/* 3-Stage Premium Wizard Progress Indicator */}
      <div style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: "12px",
        marginBottom: "24px",
        padding: "8px 12px",
        background: "white",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
        boxShadow: "0 2px 8px rgba(0,0,0,0.03)"
      }}>
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => setActiveTab("ingest")}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "10px 16px",
            border: "none",
            borderRadius: "8px",
            background: activeTab === "ingest" 
              ? "linear-gradient(135deg, #f0fdf4 0%, #e6f4ea 100%)" 
              : "transparent",
            color: activeTab === "ingest" ? "#008060" : "#5c5f62",
            borderLeft: activeTab === "ingest" ? "4px solid #008060" : "4px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s ease",
            textAlign: "left"
          }}
        >
          <span style={{ fontSize: "10px", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", color: activeTab === "ingest" ? "#008060" : "#8c9196" }}>Step 1</span>
          <span style={{ fontSize: "13px", fontWeight: 600, marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
            📥 Ingest Sources
          </span>
        </button>

        {/* Separator */}
        <div style={{ display: "flex", alignItems: "center", color: "#c9cccf", fontSize: "14px", padding: "0 4px", userSelect: "none" }}>➔</div>

        {/* Step 2 */}
        <button
          type="button"
          onClick={() => setActiveTab("crawl")}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "10px 16px",
            border: "none",
            borderRadius: "8px",
            background: activeTab === "crawl" 
              ? "linear-gradient(135deg, #f0fdf4 0%, #e6f4ea 100%)" 
              : "transparent",
            color: activeTab === "crawl" ? "#008060" : "#5c5f62",
            borderLeft: activeTab === "crawl" ? "4px solid #008060" : "4px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s ease",
            textAlign: "left"
          }}
        >
          <span style={{ fontSize: "10px", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", color: activeTab === "crawl" ? "#008060" : "#8c9196" }}>Step 2</span>
          <span style={{ fontSize: "13px", fontWeight: 600, marginTop: "2px", display: "flex", alignItems: "center", gap: "6px", width: "100%", justifyContent: "space-between" }}>
            <span>🔍 Crawl & Categorize</span>
            {crawlResult && (
              <span style={{
                background: activeTab === "crawl" ? "#008060" : "#e1e3e5",
                color: activeTab === "crawl" ? "white" : "#5c5f62",
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "10px",
                fontWeight: 700
              }}>
                {selectedProducts.length}
              </span>
            )}
          </span>
        </button>

        {/* Separator */}
        <div style={{ display: "flex", alignItems: "center", color: "#c9cccf", fontSize: "14px", padding: "0 4px", userSelect: "none" }}>➔</div>

        {/* Step 3 */}
        <button
          type="button"
          onClick={() => setActiveTab("queue")}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "10px 16px",
            border: "none",
            borderRadius: "8px",
            background: activeTab === "queue" 
              ? "linear-gradient(135deg, #f0fdf4 0%, #e6f4ea 100%)" 
              : "transparent",
            color: activeTab === "queue" ? "#008060" : "#5c5f62",
            borderLeft: activeTab === "queue" ? "4px solid #008060" : "4px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s ease",
            textAlign: "left"
          }}
        >
          <span style={{ fontSize: "10px", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", color: activeTab === "queue" ? "#008060" : "#8c9196" }}>Step 3</span>
          <span style={{ fontSize: "13px", fontWeight: 600, marginTop: "2px", display: "flex", alignItems: "center", gap: "6px", width: "100%", justifyContent: "space-between" }}>
            <span>🗂 Publish Queue</span>
            {queuedSources.length > 0 && (
              <span style={{
                background: activeTab === "queue" ? "#008060" : "#e1e3e5",
                color: activeTab === "queue" ? "white" : "#5c5f62",
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "10px",
                fontWeight: 700
              }}>
                {queuedSources.length}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Stage 1: Ingest Sources */}
      {activeTab === "ingest" && (
        <>
          <s-section heading="🎉 Welcome to Product Ingest AI Dashboard">
            <s-paragraph>
              This app is successfully installed on <strong>{storeName}</strong>. 
              Upload product documents or parse single URL structures.
            </s-paragraph>
            
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "1rem" }}>
              <span style={{ fontSize: "14px" }}><strong>Service Status:</strong></span>
              <div 
                style={{ 
                  display: "inline-block", 
                  padding: "4px 8px", 
                  borderRadius: "4px", 
                  backgroundColor: pythonServiceStatus === "online" ? "#e6f4ea" : "#fce8e6",
                  color: pythonServiceStatus === "online" ? "#137333" : "#c5221f",
                  fontSize: "12px",
                  fontWeight: 600
                }}
              >
                ● Python Service: {pythonServiceStatus.toUpperCase()}
              </div>
              <div 
                style={{ 
                  display: "inline-block", 
                  padding: "4px 8px", 
                  borderRadius: "4px", 
                  backgroundColor: "#e6f4ea",
                  color: "#137333",
                  fontSize: "12px",
                  fontWeight: 600
                }}
              >
                ● Shopify API: CONNECTED
              </div>
            </div>
          </s-section>

          <s-section heading="📥 Ingest New Sources">
            <div style={{
              background: "#f0f4f9",
              borderLeft: "4px solid #006fbb",
              padding: "12px 16px",
              borderRadius: "0 8px 8px 0",
              marginBottom: "16px",
              fontSize: "13px",
              color: "#202223",
              lineHeight: "1.5"
            }}>
              <strong style={{ display: "block", marginBottom: "4px" }}>💡 Step 1 Ingestion Guide:</strong>
              1. Choose to scrape a <strong>Website Catalog</strong> (crawl whole site), parse a <strong>Single Product URL</strong>, or upload a <strong>Catalog PDF/Document</strong>.<br />
              2. For crawling, enter the homepage URL and click <strong>Start Crawl & Discovery</strong>. The app will discover all collections and product pages automatically.<br />
              3. Once crawl is complete, you will be automatically navigated to the <strong>Crawl & Categorize</strong> (Step 2) tab.
            </div>

            <p style={{ marginBottom: "15px", fontSize: "14px", color: "#5c5f62" }}>
              Select an ingestion method to pull raw catalog data into the application.
            </p>

            {/* Ingestion Method Selection */}
            <div style={{
              display: "flex",
              gap: "8px",
              marginBottom: "20px",
              padding: "4px",
              background: "#f1f2f4",
              borderRadius: "8px",
              width: "fit-content"
            }}>
              <button
                type="button"
                onClick={() => setActiveIngestMethod("website_crawl")}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "none",
                  borderRadius: "6px",
                  background: activeIngestMethod === "website_crawl" ? "white" : "transparent",
                  color: activeIngestMethod === "website_crawl" ? "#008060" : "#5c5f62",
                  boxShadow: activeIngestMethod === "website_crawl" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                🔍 Crawl Vendor Website
              </button>
              <button
                type="button"
                onClick={() => setActiveIngestMethod("single_url")}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "none",
                  borderRadius: "6px",
                  background: activeIngestMethod === "single_url" ? "white" : "transparent",
                  color: activeIngestMethod === "single_url" ? "#008060" : "#5c5f62",
                  boxShadow: activeIngestMethod === "single_url" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                🔗 Single Product URL
              </button>
              <button
                type="button"
                onClick={() => setActiveIngestMethod("document")}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "none",
                  borderRadius: "6px",
                  background: activeIngestMethod === "document" ? "white" : "transparent",
                  color: activeIngestMethod === "document" ? "#008060" : "#5c5f62",
                  boxShadow: activeIngestMethod === "document" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                📄 Upload Documents (PDF/DOCX)
              </button>
            </div>

            {/* Conditionally Render Method Input */}
            {activeIngestMethod === "website_crawl" && (
              <div style={{
                background: "white",
                padding: "20px",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}>
                {isCreatingProfile || isEditingProfile ? (
                  <div>
                    <s-heading>{isEditingProfile ? "Edit Website Profile" : "Create New Website Profile"}</s-heading>
                    <p style={{ marginBottom: "15px", fontSize: "13px", color: "#5c5f62", marginTop: "4px" }}>
                      Provide a profile name, website domain, and optional example URLs to help the crawler identify categories and products.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#202223", marginBottom: "4px" }}>
                          Profile Name (e.g. Acme Electronics)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Acme Electronics"
                          value={profileNameInput}
                          onChange={(e) => setProfileNameInput(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            border: "1px solid #bbb",
                            fontSize: "13px",
                            boxSizing: "border-box",
                          }}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#202223", marginBottom: "4px" }}>
                          Root Website URL
                        </label>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <input
                            type="url"
                            placeholder="https://www.acme-electronics.com/"
                            value={profileRootUrlInput}
                            onChange={(e) => setProfileRootUrlInput(e.target.value)}
                            style={{
                              flex: 1,
                              padding: "8px 12px",
                              borderRadius: "4px",
                              border: "1px solid #bbb",
                              fontSize: "13px",
                              boxSizing: "border-box",
                            }}
                            required
                          />
                          <button
                            type="button"
                            onClick={handleAutoDetectPatterns}
                            disabled={isDetectingPatterns || !profileRootUrlInput}
                            style={{
                              background: "#f4f6f8",
                              border: "1px solid #c9cccf",
                              borderRadius: "4px",
                              padding: "0 12px",
                              fontSize: "13px",
                              fontWeight: 500,
                              cursor: (isDetectingPatterns || !profileRootUrlInput) ? "not-allowed" : "pointer",
                              color: (isDetectingPatterns || !profileRootUrlInput) ? "#8c9196" : "#202223"
                            }}
                          >
                            {isDetectingPatterns ? "Detecting..." : "Auto-Detect Patterns"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#202223", marginBottom: "4px" }}>
                          Collection/Category URL Example (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. /product-category/smartphones or /collections/headphones"
                          value={profileCategoryPatternInput}
                          onChange={(e) => setProfileCategoryPatternInput(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            border: "1px solid #bbb",
                            fontSize: "13px",
                            boxSizing: "border-box",
                            marginBottom: detectedCategoryExample ? "4px" : "0"
                          }}
                        />
                        {detectedCategoryExample && (
                          <div style={{ fontSize: "11px", color: "#007a5c", marginTop: "4px" }}>
                            <strong>Detected Example:</strong> {detectedCategoryExample}
                          </div>
                        )}
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#202223", marginBottom: "4px" }}>
                          Product URL Example (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. /products/iphone-14-pro or /shop/electronics/headphones"
                          value={profileProductPatternInput}
                          onChange={(e) => setProfileProductPatternInput(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            border: "1px solid #bbb",
                            fontSize: "13px",
                            boxSizing: "border-box",
                            marginBottom: detectedProductExample ? "4px" : "0"
                          }}
                        />
                        {detectedProductExample && (
                          <div style={{ fontSize: "11px", color: "#007a5c", marginTop: "4px" }}>
                            <strong>Detected Example:</strong> {detectedProductExample}
                          </div>
                        )}
                      </div>
                      
                      <div style={{ borderTop: "1px solid #e1e3e5", margin: "10px 0" }}></div>
                      
                      {/* SCHEMA BUILDER UI */}
                      <div>
                        <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#202223", margin: "0 0 8px 0" }}>Product Schema Blueprint</h4>
                        <p style={{ fontSize: "12px", color: "#5c5f62", margin: "0 0 12px 0" }}>
                          Provide a single product URL. The AI will extract the data and build deterministic CSS rules for this profile.
                        </p>
                        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                          <input
                            type="url"
                            placeholder="https://www.acme-electronics.com/products/sample"
                            value={profileSampleUrl}
                            onChange={(e) => setProfileSampleUrl(e.target.value)}
                            style={{
                              flex: 1,
                              padding: "8px 12px",
                              borderRadius: "4px",
                              border: "1px solid #bbb",
                              fontSize: "13px",
                              boxSizing: "border-box",
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleGenerateSchema}
                            disabled={isGeneratingSchema || !profileSampleUrl}
                            style={{
                              background: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                              border: "none",
                              borderRadius: "4px",
                              padding: "0 16px",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "white",
                              cursor: (isGeneratingSchema || !profileSampleUrl) ? "not-allowed" : "pointer",
                              opacity: (isGeneratingSchema || !profileSampleUrl) ? 0.7 : 1
                            }}
                          >
                            {isGeneratingSchema ? "Analyzing..." : "Generate Schema"}
                          </button>
                        </div>

                        {schemaRules && schemaProductResult && (
                          <div style={{ background: "#f4f6f8", borderRadius: "8px", border: "1px solid #e1e3e5", overflow: "hidden" }}>
                            <div style={{ padding: "12px", background: "#e1e3e5", borderBottom: "1px solid #c9cccf", fontSize: "12px", fontWeight: 600 }}>
                              Schema Mapping Review
                            </div>
                            <div style={{ padding: "12px", maxHeight: "300px", overflowY: "auto" }}>
                              <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ textAlign: "left", color: "#5c5f62", borderBottom: "1px solid #e1e3e5" }}>
                                    <th style={{ padding: "6px 0", width: "20%" }}>Field</th>
                                    <th style={{ padding: "6px 0", width: "45%" }}>Extracted Value</th>
                                    <th style={{ padding: "6px 0", width: "35%" }}>CSS Selector</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const rows: Array<{ key: string; label: string; value: any; selector?: string }> = [];
                                    
                                    // 1. Core top-level fields
                                    const coreKeys = ["title", "description", "price", "vendor", "category", "sku", "tags"];
                                    const processedKeys = new Set<string>();

                                    coreKeys.forEach((k) => {
                                      const val = schemaProductResult[k];
                                      const rule = schemaRules[k];
                                      if (val !== undefined && val !== null && val !== "" && (!Array.isArray(val) || val.length > 0)) {
                                        processedKeys.add(k);
                                        rows.push({
                                          key: k,
                                          label: k,
                                          value: typeof val === "object" ? JSON.stringify(val) : String(val),
                                          selector: (typeof rule === "object" && rule?.selector) ? rule.selector : `${k} (AI Detected)`
                                        });
                                      }
                                    });

                                    // Add any additional top-level rules generated by AI
                                    Object.entries(schemaRules).forEach(([k, r]: [string, any]) => {
                                      if (k !== 'metafields' && !processedKeys.has(k) && typeof r === 'object' && r !== null && r.selector) {
                                        rows.push({
                                          key: k,
                                          label: k,
                                          value: schemaProductResult[k] || "N/A",
                                          selector: r.selector
                                        });
                                      }
                                    });

                                    // 2. Custom Metafields & Specifications (e.g. Hair Material, Texture, Style, Lengths, Colors)
                                    const metafieldsObj = schemaProductResult.metafields || {};
                                    const metafieldsRules = (schemaRules.metafields || {}) as Record<string, any>;
                                    Object.entries(metafieldsObj).forEach(([mk, mv]) => {
                                      rows.push({
                                        key: `metafield:${mk}`,
                                        label: `Metafield: ${mk}`,
                                        value: mv,
                                        selector: metafieldsRules[mk]?.selector || ".product-details, table, .specs"
                                      });
                                    });

                                    // 3. Product Swatch / Variant Options
                                    if (Array.isArray(schemaProductResult.options) && schemaProductResult.options.length > 0) {
                                      schemaProductResult.options.forEach((opt: any) => {
                                        rows.push({
                                          key: `option:${opt.name}`,
                                          label: `Option: ${opt.name}`,
                                          value: Array.isArray(opt.values) ? opt.values.join(", ") : String(opt.values),
                                          selector: ".variant-option, select, .swatch"
                                        });
                                      });
                                    }

                                    // 4. Variants Count
                                    if (Array.isArray(schemaProductResult.variants) && schemaProductResult.variants.length > 0) {
                                      rows.push({
                                        key: "variants_count",
                                        label: "Variants",
                                        value: `${schemaProductResult.variants.length} variant combinations extracted`,
                                        selector: "script[type='application/ld+json'], .variant-selector"
                                      });
                                    }

                                    return rows.map((row) => (
                                      <tr key={row.key} style={{ borderBottom: "1px solid #eaeaea" }}>
                                        <td style={{ padding: "8px 0", fontWeight: 600, color: row.key.startsWith('metafield:') ? '#005bd3' : (row.key.startsWith('option:') ? '#007a5c' : '#202223') }}>
                                          {row.label}
                                        </td>
                                        <td style={{ padding: "8px 8px 8px 0" }}>
                                          <div style={{ 
                                            maxHeight: "50px", 
                                            overflowY: "auto",
                                            fontSize: "11px",
                                            color: "#202223",
                                            wordBreak: "break-word"
                                          }}>
                                            {typeof row.value === 'object' ? JSON.stringify(row.value) : (String(row.value || "—"))}
                                          </div>
                                        </td>
                                        <td style={{ padding: "8px 0" }}>
                                          <select 
                                            value={row.selector || ""}
                                            onChange={(e) => {
                                              const newSel = e.target.value;
                                              if (row.key.startsWith('metafield:')) {
                                                const mk = row.key.replace('metafield:', '');
                                                setSchemaRules((prev: any) => ({
                                                  ...prev,
                                                  metafields: {
                                                    ...(prev.metafields || {}),
                                                    [mk]: { selector: newSel }
                                                  }
                                                }));
                                              } else {
                                                setSchemaRules((prev: any) => ({
                                                  ...prev,
                                                  [row.key]: { ...(prev[row.key] || {}), selector: newSel }
                                                }));
                                              }
                                            }}
                                            style={{
                                              width: "100%",
                                              padding: "4px",
                                              fontSize: "11px",
                                              border: "1px solid #c9cccf",
                                              borderRadius: "4px",
                                              background: "white"
                                            }}
                                          >
                                            <option value={row.selector}>{row.selector || "auto-detected"} (AI Detected)</option>
                                            <optgroup label="Alternatives from Page">
                                              {schemaCandidates.map((c, i) => (
                                                <option key={i} value={c.selector}>
                                                  {c.selector} - "{c.text.substring(0, 30)}..."
                                                </option>
                                              ))}
                                            </optgroup>
                                          </select>
                                        </td>
                                      </tr>
                                    ));
                                  })()}
                                </tbody>
                              </table>
                            </div>
                            <div style={{ padding: "10px 12px", fontSize: "11px", color: "#5c5f62", background: "#fff", borderTop: "1px solid #e1e3e5" }}>
                              If a selector is incorrect, use the dropdown to choose an alternative text element from the page.
                            </div>
                          </div>
                        )}

                        {detectedProductExample && (
                          <div style={{ fontSize: "11px", color: "#007a5c", marginTop: "4px" }}>
                            <strong>Detected Example:</strong> {detectedProductExample}
                          </div>
                        )}
                      </div>
                      
                      {/* Website Platform Quick Reference Guide */}
                      <details style={{ marginTop: "10px", background: "#f6f6f7", padding: "12px", borderRadius: "6px", border: "1px solid #e1e3e5" }}>
                        <summary style={{ cursor: "pointer", fontSize: "13px", color: "#008060", fontWeight: 500, outline: "none", userSelect: "none" }}>
                          💡 Website Platform Quick Reference Guide (Slug Identification)
                        </summary>
                        <div style={{ marginTop: "10px", overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                            <thead>
                              <tr style={{ borderBottom: "2px solid #e1e3e5", color: "#202223" }}>
                                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Platform</th>
                                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Pattern Type</th>
                                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Category Marker</th>
                                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Product Marker</th>
                                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Note for Scraper Agent</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                { name: "Shopify", type: "Fixed", cat: "/collections/", prod: "/products/", note: "Standardized. Highly predictable." },
                                { name: "WooCommerce", type: "CMS", cat: "/product-category/", prod: "/product/", note: "Paths often customizable via SEO plugins." },
                                { name: "Magento 2", type: "Flexible", cat: "/category/", prod: "/product/", note: "Heavy use of rewrites. Watch for query params." },
                                { name: "BigCommerce", type: "Fixed", cat: "/categories/", prod: "/products/", note: "Very similar to Shopify, slightly different slugs." },
                                { name: "PrestaShop", type: "Short", cat: "/c/", prod: "/p/", note: "Compact paths; watch for ID-based URL appending." },
                                { name: "Squarespace", type: "CMS", cat: "/category/", prod: "/p/", note: "Often uses /shop/ or /p/ as a base." },
                                { name: "Wix", type: "Hybrid", cat: "/category/", prod: "/product-page/", note: "Unique dynamic rendering; requires JS wait." },
                                { name: "OpenCart", type: "Legacy", cat: "/category/", prod: "/product/", note: "Often retains query string fallbacks." },
                                { name: "Volusion", type: "Fixed", cat: "/c/", prod: "/product/", note: "Rigid; limited slug customization." },
                                { name: "Zen Cart", type: "Query", cat: "?cPath=", prod: "?products_id=", note: "Non-RESTful. Must parse URL query strings." },
                                { name: "MedusaJS", type: "Headless", cat: "/collections/", prod: "/products/", note: "API-first; structure is often 'Shopify-like'." },
                                { name: "Saleor", type: "Headless", cat: "/category/", prod: "/product/", note: "GraphQL-driven; structure depends on frontend." },
                                { name: "Shopline", type: "Fixed", cat: "/collections/", prod: "/products/", note: "Asian market leader; follows Shopify logic." },
                                { name: "Nuvemshop", type: "Fixed", cat: "/c/", prod: "/p/", note: "Latin American focus; compact slug style." },
                                { name: "CS-Cart", type: "Hybrid", cat: "/category/", prod: "/product/", note: "Can switch between SEO-friendly and IDs." },
                                { name: "X-Cart", type: "Flexible", cat: "/category/", prod: "/p/", note: "SEO settings allow custom path prefixes." },
                                { name: "Sylius", type: "Headless", cat: "/category/", prod: "/product/", note: "Symfony-based; typically clean REST paths." },
                                { name: "Drupal Commerce", type: "CMS", cat: "/category/", prod: "/product/", note: "Deeply nested taxonomy possible." }
                              ].map((row, index) => (
                                <tr key={row.name} style={{ borderBottom: "1px solid #e1e3e5", background: index % 2 === 0 ? "#f9fafb" : "white" }}>
                                  <td style={{ padding: "6px 8px", fontWeight: 500, color: "#202223" }}>{row.name}</td>
                                  <td style={{ padding: "6px 8px", color: "#6d7175" }}>{row.type}</td>
                                  <td style={{ padding: "6px 8px" }}><code>{row.cat}</code></td>
                                  <td style={{ padding: "6px 8px" }}><code>{row.prod}</code></td>
                                  <td style={{ padding: "6px 8px", color: "#5c5f62" }}>{row.note}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>

                      <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                        <s-button variant="primary" disabled={isSavingProfile} onClick={handleSaveProfile}>
                          {isSavingProfile ? "Saving..." : "Save Profile"}
                        </s-button>
                        <s-button onClick={() => { setIsCreatingProfile(false); setIsEditingProfile(false); }}>
                          Cancel
                        </s-button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <s-heading>Crawl Vendor Catalog</s-heading>
                    <p style={{ marginBottom: "15px", fontSize: "14px", color: "#5c5f62" }}>
                      Select a website crawl profile to run crawlers and discover products. Create multiple profiles to manage different vendor sites with isolated sessions.
                    </p>

                    <div style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "12px",
                      marginBottom: "15px",
                      background: "#f6f6f7",
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid #e1e3e5"
                    }}>
                      <div style={{ flex: 1, minWidth: "220px" }}>
                        <select
                          value={selectedProfileId || ""}
                          onChange={(e) => handleSelectProfile(e.target.value || null)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            border: "1px solid #ccc",
                            fontSize: "13.5px",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">-- Select Website Profile --</option>
                          {profiles.map(p => {
                            let domainLabel = "";
                            try {
                              domainLabel = new URL(p.rootUrl).hostname;
                            } catch {
                              domainLabel = p.rootUrl;
                            }
                            return (
                              <option key={p.id} value={p.id}>{p.name} ({domainLabel})</option>
                            );
                          })}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <s-button onClick={startCreatingProfile}>Add New Profile</s-button>
                        {selectedProfileId && (
                          <>
                            <s-button onClick={startEditingProfile}>Edit</s-button>
                            <s-button onClick={() => handleDeleteProfile(selectedProfileId)}>Delete</s-button>
                          </>
                        )}
                      </div>
                    </div>

                    {selectedProfileId ? (
                      <div>
                        <div style={{
                          background: "#f1f2f4",
                          padding: "12px 16px",
                          borderRadius: "6px",
                          border: "1px solid #e1e3e5",
                          fontSize: "13px",
                          marginBottom: "15px"
                        }}>
                          <div style={{ fontWeight: 600, color: "#202223", marginBottom: "6px" }}>Isolated Crawl Settings:</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#5c5f62" }}>
                            <div><strong>Website Root URL:</strong> <code>{profiles.find(p => p.id === selectedProfileId)?.rootUrl}</code></div>
                            {customProductPattern && <div><strong>Custom Product URL Pattern:</strong> <code>{customProductPattern}</code></div>}
                            {customCategoryPattern && <div><strong>Custom Category URL Pattern:</strong> <code>{customCategoryPattern}</code></div>}
                          </div>
                        </div>
                        
                        <form onSubmit={handleCrawlSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#202223", marginBottom: "6px" }}>
                              Target URL for Current Session (Root, Collection, or Product)
                            </label>
                            <div style={{ display: "flex", gap: "10px" }}>
                              <input
                                type="url"
                                placeholder="e.g. https://www.acme-electronics.com/collections/smartphones"
                                value={crawlUrlInput}
                                onChange={(e) => setCrawlUrlInput(e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: "10px 14px",
                                  borderRadius: "6px",
                                  border: "1px solid #ccc",
                                  fontSize: "14px",
                                  boxSizing: "border-box",
                                }}
                                required
                              />
                              <div style={{ display: "flex", alignItems: "stretch" }}>
                                <s-button type="submit" variant="primary" disabled={isCrawling}>
                                  {isCrawling ? "Discovering..." : "Discover / Ingest"}
                                </s-button>
                              </div>
                            </div>
                            <span style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px", display: "block" }}>
                              Pasting a product page URL will automatically route to Single URL Mode for instant details extraction.
                            </span>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div style={{
                        padding: "30px 20px",
                        textAlign: "center",
                        background: "#f9fafb",
                        border: "1px dashed #ccc",
                        borderRadius: "6px",
                        color: "#6d7175",
                        fontSize: "13.5px"
                      }}>
                        No website profile selected. Select a profile from the dropdown or click "Add New Profile" to configure a new crawler.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeIngestMethod === "single_url" && (
              <div style={{
                background: "white",
                padding: "20px",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}>
                <s-heading>Parse Single Product URL</s-heading>
                <p style={{ marginBottom: "15px", fontSize: "14px", color: "#5c5f62" }}>
                  Provide a single product detail page URL to instantly scrape, extract attributes, and publish to Shopify.
                </p>
                <form onSubmit={handleUrlSubmit}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      {urlFavicon && (
                        <img 
                          src={urlFavicon} 
                          alt="favicon" 
                          style={{
                            position: "absolute",
                            left: "12px",
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                            pointerEvents: "none"
                          }}
                        />
                      )}
                      <input
                        type="url"
                        placeholder="https://vendor.com/products/valve-100"
                        value={urlInput}
                        onChange={(e) => handleUrlInputChange(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          paddingLeft: urlFavicon ? "40px" : "14px",
                          borderRadius: "6px",
                          border: urlValidationError ? "1px solid #c5221f" : "1px solid #ccc",
                          fontSize: "14px",
                          boxSizing: "border-box",
                          transition: "all 0.15s ease",
                        }}
                        required
                      />
                    </div>
                    {urlValidationError && (
                      <p style={{ color: "#c5221f", fontSize: "12px", margin: "0 0 4px 0" }}>⚠️ {urlValidationError}</p>
                    )}
                    <s-button type="submit" variant="primary" disabled={!!urlValidationError || !urlInput}>
                      Stage URL for Ingestion
                    </s-button>
                  </div>
                </form>
              </div>
            )}

            {activeIngestMethod === "document" && (
              <div style={{
                background: "white",
                padding: "20px",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}>
                <s-heading>Drag & Drop Documents</s-heading>
                <p style={{ marginBottom: "15px", fontSize: "14px", color: "#5c5f62" }}>
                  Upload product specification catalogs, brochures, or price sheets to extract and ingest product schemas.
                </p>
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
                    border: isDragOver ? "2px dashed #008060" : "2px dashed #c9cccf",
                    borderRadius: "12px",
                    padding: "48px 24px",
                    textAlign: "center",
                    background: isDragOver 
                      ? "rgba(240, 253, 244, 0.6)" 
                      : "rgba(250, 250, 250, 0.4)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    cursor: "pointer",
                    transition: "all 0.25s ease",
                    marginTop: "10px",
                    boxShadow: isDragOver 
                      ? "0 8px 24px rgba(0, 128, 96, 0.08), inset 0 0 12px rgba(0, 128, 96, 0.05)" 
                      : "0 4px 12px rgba(0,0,0,0.02)",
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
                  <div style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    background: isDragOver ? "#e6f4ea" : "#f1f2f4",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px auto",
                    transition: "transform 0.2s ease",
                    transform: isDragOver ? "scale(1.1) rotate(5deg)" : "scale(1)",
                  }}>
                    <span style={{ fontSize: "28px", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }}>
                      {isDragOver ? "📥" : "📄"}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 6px 0", fontSize: "15px", color: "#202223" }}>
                    <strong>Drag &amp; drop your catalog here</strong> or <span style={{ color: "#008060", textDecoration: "underline", fontWeight: 600 }}>browse files</span>
                  </p>
                  <span style={{ fontSize: "12px", color: "#6d7175" }}>
                    Supports PDF, DOCX, HTML, or TXT up to 10MB
                  </span>
                </div>

                {/* Active Uploads / Conversion Queue Progress Tracker */}
                {queuedSources.some(s => s.status === "converting" || conversionProgress[s.id] !== undefined) && (
                  <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#202223", margin: "0 0 4px 0" }}>Active Ingestion Queue:</h4>
                    {queuedSources.filter(s => s.status === "converting" || conversionProgress[s.id] !== undefined).map(source => {
                      const progress = conversionProgress[source.id] || 15;
                      return (
                        <div key={source.id} style={{
                          display: "flex",
                          flexDirection: "column",
                          background: "white",
                          border: "1px solid #e1e3e5",
                          borderRadius: "8px",
                          padding: "12px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "18px" }}>⏳</span>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <span style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>{source.name}</span>
                                <span style={{ fontSize: "11px", color: "#6d7175" }}>{source.size || "Unknown size"} · Converting to Markdown...</span>
                              </div>
                            </div>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#008060" }}>{progress}%</span>
                          </div>
                          
                          {/* Progress bar wrapper */}
                          <div style={{
                            width: "100%",
                            height: "6px",
                            background: "#f1f2f4",
                            borderRadius: "3px",
                            overflow: "hidden"
                          }}>
                            <div style={{
                              width: `${progress}%`,
                              height: "100%",
                              background: "linear-gradient(90deg, #008060 0%, #34d399 100%)",
                              borderRadius: "3px",
                              transition: "width 0.3s ease-in-out"
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Proceed to Next Step Navigation Footer */}
            {(queuedSources.length > 0 || crawlResult) && (
              <div style={{
                marginTop: "24px",
                paddingTop: "16px",
                borderTop: "1px solid #e1e3e5",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
                alignItems: "center"
              }}>
                <span style={{ fontSize: "13px", color: "#6d7175" }}>
                  {crawlResult ? "Catalog discovered! " : ""}{queuedSources.length > 0 ? `(${queuedSources.length} sources in queue)` : ""}
                </span>
                {crawlResult && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("crawl")}
                    style={{
                      padding: "10px 20px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "8px",
                      border: "1px solid #c9cccf",
                      background: "white",
                      color: "#202223",
                      cursor: "pointer",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                    }}
                  >
                    View Crawled Catalog ➔
                  </button>
                )}
                {queuedSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("queue")}
                    style={{
                      padding: "10px 20px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "8px",
                      border: "none",
                      background: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                      color: "white",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                    }}
                  >
                    Proceed to Publish Queue ➔
                  </button>
                )}
              </div>
            )}
          </s-section>
        </>
      )}

      {/* Stage 2: Crawl & Categorize */}
      {activeTab === "crawl" && (
        <>
          <s-section heading="🔍 Crawled Vendor Website Catalog">
            {isCrawling && (
              <div style={{
                background: "#0f172a",
                borderRadius: "12px",
                border: "1px solid #1e293b",
                padding: "20px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                maxWidth: "100%",
                margin: "0 auto",
                fontFamily: "Fira Code, SFMono-Regular, Consolas, Monaco, monospace",
                textAlign: "left"
              }}>
                {/* Console Title Bar */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #1e293b",
                  paddingBottom: "12px",
                  marginBottom: "16px"
                }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444" }} />
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#f59e0b" }} />
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, letterSpacing: "1px" }}>CRAWLER_CONSOLE.LOG</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#10b981",
                      boxShadow: "0 0 8px #10b981",
                    }} />
                    <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 600 }}>LIVE</span>
                  </div>
                </div>

                {/* Console Log Content Area */}
                <div style={{
                  height: "220px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "12.5px",
                  lineHeight: "1.6",
                  color: "#e2e8f0",
                  paddingRight: "8px"
                }}>
                  {crawlLogs.map((log, index) => {
                    let color = "#e2e8f0";
                    if (log.includes("[System]")) color = "#38bdf8";
                    else if (log.includes("[Robots]")) color = "#fb7185";
                    else if (log.includes("[Sitemap]")) color = "#c084fc";
                    else if (log.includes("[Crawler]")) color = "#fb923c";
                    else if (log.includes("[AI Analyzer]")) color = "#34d399";
                    else if (log.includes("[Grouping]")) color = "#a7f3d0";
                    
                    return (
                      <div key={index} style={{ wordBreak: "break-all", fontFamily: "inherit" }}>
                        <span style={{ color: "#64748b", marginRight: "10px", userSelect: "none" }}>{(index + 1).toString().padStart(2, "0")}</span>
                        <span style={{ color }}>{log}</span>
                      </div>
                    );
                  })}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            )}

            {!isCrawling && !crawlResult && (
              <div style={{ textAlign: "center", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #c9cccf", padding: "30px 20px" }}>
                <p style={{ color: "#6d7175", fontSize: "14px" }}>No crawled catalog data yet. Please go to the "Ingest Sources" tab and discover a catalog or upload a file.</p>
              </div>
            )}

            {!isCrawling && crawlResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{
                  background: "#f0f4f9",
                  borderLeft: "4px solid #006fbb",
                  padding: "12px 16px",
                  borderRadius: "0 8px 8px 0",
                  marginBottom: "4px",
                  fontSize: "13px",
                  color: "#202223",
                  lineHeight: "1.5"
                }}>
                  <strong style={{ display: "block", marginBottom: "4px" }}>💡 Step 2 Categorization Guide:</strong>
                  1. Below is the list of discovered categories and products from the vendor's website.<br />
                  2. Toggle <strong>Intelligently group similar series / variants</strong> to automatically group similar models together as Shopify variants.<br />
                  3. Check the categories or individual products you want to import. You can map each group to a Shopify collection or choose to create new ones.<br />
                  4. Click <strong>🚀 Bulk Import & Create Categories</strong> to push them into the Queue (Step 3).
                </div>
                {/* Site Metadata Badges */}
                <div style={{ display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{
                    padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                    background: crawlResult.mocked ? "#fff9e6" : "#e6f4ea",
                    color: crawlResult.mocked ? "#b27800" : "#137333",
                    border: `1px solid ${crawlResult.mocked ? "#ffe89e" : "#c4ebd0"}`
                  }}>
                    Domain: {crawlResult.domain}{crawlResult.mocked && " (Mocked)"}
                  </span>
                  {crawlResult.llms_txt ? (
                    <span style={{
                      padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                      background: "#e8f0fe", color: "#1a73e8", border: "1px solid #c2e7ff"
                    }}>llms.txt Discovered</span>
                  ) : (
                    <span style={{
                      padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                      background: "#f1f3f4", color: "#3c4043", border: "1px solid #dadce0"
                    }}>No llms.txt</span>
                  )}
                  {crawlResult.robots?.sitemaps?.length > 0 && (
                    <span style={{
                      padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                      background: "#e6f4ea", color: "#137333", border: "1px solid #c4ebd0"
                    }}>
                      {crawlResult.robots.sitemaps.length} Sitemap(s) Found
                    </span>
                  )}
                  {crawlResult.robots?.crawl_delay && (
                    <span style={{
                      padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                      background: "#fef7e0", color: "#b06000", border: "1px solid #fce8b2"
                    }}>
                      Delay: {crawlResult.robots.crawl_delay}s
                    </span>
                  )}
                </div>

                {/* Collapsible llms.txt details if exists */}
                {crawlResult.llms_txt && (
                  <div style={{ padding: "8px", backgroundColor: "#f6f6f7", borderRadius: "4px", border: "1px solid #e1e3e5" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 6px 0", color: "#202223" }}>llms.txt content</h3>
                    <pre style={{ margin: "5px 0 0 0", fontSize: "11px", whiteSpace: "pre-wrap", background: "#f1f1f1", padding: "8px", borderRadius: "4px" }}>
                      {crawlResult.llms_txt}
                    </pre>
                  </div>
                )}

                {/* Metafields & Attributes Mapping Panel */}
                <div style={{
                  background: "white",
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid #e1e3e5",
                  marginTop: "15px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                }}>
                  <h3 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px 0", color: "#202223" }}>
                    🏷️ Shopify Metafields & Attributes Mapping
                  </h3>
                  <p style={{ fontSize: "13px", color: "#5c5f62", margin: "0 0 12px 0" }}>
                    Map discovered custom specifications to Shopify Product Metafield definitions. Undefined or skipped attributes will not be published.
                  </p>
                  
                  {(() => {
                    const uniqueSpecs = new Set<string>();
                    crawlResult.categories.forEach((cat: any) => {
                      if (cat.products) {
                        cat.products.forEach((p: any) => {
                          if (p.specifications) {
                            p.specifications.forEach((s: any) => {
                              if (s.name) uniqueSpecs.add(s.name.trim());
                            });
                          }
                        });
                      }
                    });
                    
                    const specList = Array.from(uniqueSpecs);
                    
                    if (specList.length === 0) {
                      return (
                        <div style={{ fontSize: "13px", color: "#6d7175", fontStyle: "italic" }}>
                          No custom specification attributes detected in this crawl session.
                        </div>
                      );
                    }
                    
                    return (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                          <thead>
                            <tr style={{ borderBottom: "2px solid #e1e3e5", color: "#202223" }}>
                              <th style={{ padding: "8px", fontWeight: 600 }}>Discovered Attribute</th>
                              <th style={{ padding: "8px", fontWeight: 600 }}>Shopify Metafield Target</th>
                              <th style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {specList.map((specName) => {
                              const currentMap = metafieldMappings[specName] || "skip";
                              const isCreating = isCreatingMetafield[specName] || false;
                              
                              const cleanAttr = specName.trim();
                              const slug = cleanAttr
                                .toLowerCase()
                                .replace(/[^a-z0-9_]/g, "_")
                                .replace(/__+/g, "_")
                                .replace(/^_+|_+$/g, "");
                              
                              const activeProfile = profiles.find(p => p.id === selectedProfileId);
                              let platform = "Shopify";
                              if (activeProfile) {
                                if (activeProfile.categoryPattern.includes("product-category") || activeProfile.rootUrl.includes("woocommerce")) {
                                  platform = "WooCommerce";
                                }
                              }
                              const finalKey = platform === "WooCommerce" ? `pa_${slug}` : slug;
                              
                              return (
                                <tr key={specName} style={{ borderBottom: "1px solid #f4f6f8" }}>
                                  <td style={{ padding: "8px", fontWeight: 500, color: "#202223" }}>{specName}</td>
                                  <td style={{ padding: "8px" }}>
                                    <select
                                      value={currentMap}
                                      onChange={(e) => setMetafieldMappings(prev => ({ ...prev, [specName]: e.target.value }))}
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: "6px",
                                        border: "1px solid #ccc",
                                        fontSize: "13px",
                                        background: "white",
                                        cursor: "pointer",
                                        width: "100%",
                                        maxWidth: "280px"
                                      }}
                                    >
                                      <option value="skip">⚠️ Skip / Exclude Attribute</option>
                                      <optgroup label="Auto-Create Definition">
                                        <option value={`new:custom.${finalKey}`}>
                                          🆕 Create custom.{finalKey} (Approved by user)
                                        </option>
                                      </optgroup>
                                      {existingMetafields.length > 0 && (
                                        <optgroup label="Map to Existing Shopify Metafields">
                                          {existingMetafields.map((def) => (
                                            <option key={def.id} value={`${def.namespace}.${def.key}`}>
                                              📁 {def.namespace}.{def.key} ({def.name})
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </select>
                                  </td>
                                  <td style={{ padding: "8px", textAlign: "right" }}>
                                    {currentMap.startsWith("new:") ? (
                                      <s-button
                                        variant="primary"
                                        disabled={isCreating}
                                        onClick={() => handleCreateMetafieldDefinition(specName)}
                                      >
                                        {isCreating ? "Creating..." : "Approve & Create"}
                                      </s-button>
                                    ) : (
                                      <span style={{ fontSize: "12px", color: currentMap === "skip" ? "#8c9196" : "#008060" }}>
                                        {currentMap === "skip" ? "Excluded" : "✓ Mapped"}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                {/* Collapsible Category Tree */}
                <h3 style={{ fontSize: "16px", fontWeight: 600, margin: "20px 0 4px 0", color: "#202223" }}>Discovered Categories & Products</h3>
                <p style={{ fontSize: "14px", color: "#5c5f62", margin: "0 0 12px 0" }}>Select which categories or specific products to scrape and queue:</p>

                {/* Grouping Toggle Option */}
                <div style={{ marginBottom: "15px", padding: "12px", background: "#f6f6f7", borderRadius: "6px" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
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
                  </div>
                </div>

                {/* Collection Grouping Stats Bar */}
                {groupSimilar && groupingStats && (
                  <div
                    style={{
                      border: "1px solid #e1e3e5",
                      display: "flex",
                      alignItems: "center",
                      gap: "15px",
                      flexWrap: "wrap",
                      padding: "12px",
                      background: "white",
                      borderRadius: "6px",
                      marginBottom: "12px",
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
                  </div>
                )}

                <div style={{ paddingLeft: "10px" }}>

                  {Object.entries(groupedCategories).map(([catName, groups]) => {
                    const isCatExpanded = !!expandedCategories[catName];
                    const catKeysForCat: string[] = [];
                    
                    if (groupSimilar) {
                      groups.forEach((group: any, groupIdx: number) => {
                        group.variants.forEach((v: any, variantIdx: number) => {
                          catKeysForCat.push(`${catName}::grouped::${groupIdx}::${variantIdx}`);
                        });
                      });
                    } else {
                      let flatIdx = 0;
                      groups.forEach((group: any) => {
                        group.variants.forEach((v: any) => {
                          catKeysForCat.push(`${catName}::standalone::${flatIdx}`);
                          flatIdx++;
                        });
                      });
                    }

                    const selectedInCat = selectedProducts.filter(key => catKeysForCat.includes(key));
                    const isAllSelected = catKeysForCat.length > 0 && selectedInCat.length === catKeysForCat.length;
                    const isSomeSelected = selectedInCat.length > 0 && !isAllSelected;

                    // Calculate total products in this category
                    const productCount = groups.reduce((acc: number, group: any) => acc + (group.variants ? group.variants.length : 0), 0);

                    return (
                      <div key={catName} style={{ marginBottom: "10px", borderBottom: "1px solid #f4f6f8", paddingBottom: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <button
                            type="button"
                            onClick={() => toggleCategoryExpand(catName)}
                            style={{
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              padding: "4px 8px",
                              fontSize: "14px",
                              color: "#5c5f62",
                              display: "inline-flex",
                              alignItems: "center"
                            }}
                          >
                            {isCatExpanded ? "▼" : "▶"}
                          </button>
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            ref={el => {
                              if (el) el.indeterminate = isSomeSelected;
                            }}
                            onChange={(e) => handleCategorySelectToggle(catName, groups, e.target.checked)}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                          <strong style={{ fontSize: "14px", color: "#202223" }}>
                            {catName} ({productCount} products)
                          </strong>
                        </div>

                        {isCatExpanded && (
                          <div style={{ paddingLeft: "30px", marginTop: "8px" }}>
                            {groupSimilar ? (
                              groups.map((group: any, groupIdx: number) => {
                                if (group.is_grouped) {
                                  const isGroupExpanded = !!expandedGroups[group.title];
                                  const groupKeys = group.variants.map((v: any, variantIdx: number) => 
                                    `${catName}::grouped::${groupIdx}::${variantIdx}`
                                  );
                                  const selectedInGroup = selectedProducts.filter(key => groupKeys.includes(key));
                                  const isAllGroupSelected = selectedInGroup.length === groupKeys.length;
                                  const isSomeGroupSelected = selectedInGroup.length > 0 && !isAllGroupSelected;

                                  return (
                                    <div key={group.title} style={{ margin: "10px 0", paddingLeft: "15px", borderLeft: `2px solid ${group.collection_match ? "#008060" : "#ffa500"}` }}>
                                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                                        <button
                                          type="button"
                                          onClick={() => toggleGroupExpand(group.title)}
                                          style={{
                                            border: "none",
                                            background: "transparent",
                                            cursor: "pointer",
                                            padding: "4px 8px",
                                            fontSize: "12px",
                                            color: "#5c5f62",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            marginTop: "2px"
                                          }}
                                        >
                                          {isGroupExpanded ? "▼" : "▶"}
                                        </button>
                                        <input
                                          type="checkbox"
                                          checked={isAllGroupSelected}
                                          ref={el => {
                                            if (el) el.indeterminate = isSomeGroupSelected;
                                          }}
                                          onChange={(e) => handleGroupSelectToggle(catName, groupIdx, group, e.target.checked)}
                                          style={{ cursor: "pointer", width: "14px", height: "14px", marginTop: "6px" }}
                                        />
                                        <div style={{ flex: 1 }}>
                                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                            <strong style={{ fontSize: "13px" }}>{group.title}</strong>
                                            <span style={{
                                              padding: "2px 8px",
                                              borderRadius: "10px",
                                              fontSize: "11px",
                                              fontWeight: 600,
                                              background: "#e0f2fe",
                                              color: "#0369a1",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}>
                                              {group.variants.length} Variants
                                            </span>
                                            {group.options && group.options.map((opt: string) => (
                                              <span key={opt} style={{ padding: "2px 6px", background: "#e1e3e5", borderRadius: "4px", fontSize: "11px", fontWeight: 500 }}>{opt}</span>
                                            ))}
                                          </div>

                                          {/* Collection assignment row */}
                                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                                            {/* Auto-match badge */}
                                            {group.collection_match && groupCollectionOverride[group.title] === undefined && (() => {
                                              const scorePct = Math.round(group.collection_match.score * 100);
                                              let badgeBg = "#f0fdf4";
                                              let badgeBorder = "1px solid #bbf7d0";
                                              let badgeColor = "#166534";
                                              let indicatorColor = "#10b981";

                                              if (scorePct < 50) {
                                                badgeBg = "#f1f2f4";
                                                badgeBorder = "1px solid #c9cccf";
                                                badgeColor = "#4b5563";
                                                indicatorColor = "#9ca3af";
                                              } else if (scorePct < 80) {
                                                badgeBg = "#fef7e0";
                                                badgeBorder = "1px solid #fce8b2";
                                                badgeColor = "#b06000";
                                                indicatorColor = "#f59e0b";
                                              }

                                              return (
                                                <span style={{
                                                  background: badgeBg,
                                                  color: badgeColor,
                                                  border: badgeBorder,
                                                  padding: "3px 10px",
                                                  borderRadius: "12px",
                                                  fontSize: "11px",
                                                  fontWeight: 600,
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
                                                }}>
                                                  <span>📁</span>
                                                  <span>{group.collection_match.title}</span>
                                                  <span style={{
                                                    display: "inline-block",
                                                    width: "6px",
                                                    height: "6px",
                                                    borderRadius: "50%",
                                                    background: indicatorColor
                                                  }} />
                                                  <span style={{ opacity: 0.75, fontSize: "10px", fontWeight: 500 }}>
                                                    {scorePct}% match
                                                  </span>
                                                </span>
                                              );
                                            })()}
                                            {!group.collection_match && groupCollectionOverride[group.title] === undefined && (
                                              <span style={{
                                                background: "#f3e8ff",
                                                color: "#6b21a8",
                                                border: "1px solid #e9d5ff",
                                                padding: "3px 10px",
                                                borderRadius: "12px",
                                                fontSize: "11px",
                                                fontWeight: 600,
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
                                              }}>
                                                ✦ New Collection
                                              </span>
                                            )}
                                            {groupCollectionOverride[group.title] !== undefined && (() => {
                                              const isNew = !groupCollectionOverride[group.title];
                                              const collTitle = isNew 
                                                ? "New Collection" 
                                                : (shopifyCollections.find(c => c.id === groupCollectionOverride[group.title])?.title ?? "Selected");
                                              
                                              return (
                                                <span style={{
                                                  background: isNew ? "#f3e8ff" : "#f0fdf4",
                                                  color: isNew ? "#6b21a8" : "#166534",
                                                  border: `1px solid ${isNew ? "#e9d5ff" : "#bbf7d0"}`,
                                                  padding: "3px 10px",
                                                  borderRadius: "12px",
                                                  fontSize: "11px",
                                                  fontWeight: 600,
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "4px",
                                                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
                                                }}>
                                                  {isNew ? "✦" : "📁"} {collTitle}
                                                </span>
                                              );
                                            })()}

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
                                              {shopifyCollections.map((col) => (
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
                                          {group.variants.map((variant: any, variantIdx: number) => {
                                            const pathKey = `${catName}::grouped::${groupIdx}::${variantIdx}`;
                                            const isChecked = selectedProducts.includes(pathKey);
                                            return (
                                              <div key={pathKey} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
                                                <input
                                                  type="checkbox"
                                                  checked={isChecked}
                                                  onChange={() => handleProductSelectToggle(pathKey)}
                                                  style={{ cursor: "pointer" }}
                                                />
                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{variant.name}</span>
                                                  <span style={{ fontSize: "12px", color: "#6d7175" }}>
                                                    {variant.url} {variant.option_values && `| ${JSON.stringify(variant.option_values)}`}
                                                  </span>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                } else {
                                  const standalone = group.variants[0];
                                  const pathKey = `${catName}::grouped::${groupIdx}::0`;
                                  const isChecked = selectedProducts.includes(pathKey);
                                  const collMatch = group.collection_match;
                                  const overrideId = groupCollectionOverride[standalone.name];
                                  return (
                                    <div key={pathKey} style={{ margin: "6px 0", paddingLeft: "15px" }}>
                                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => handleProductSelectToggle(pathKey)}
                                          style={{ cursor: "pointer", marginTop: "3px" }}
                                        />
                                        <div style={{ flex: 1 }}>
                                          <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span style={{ fontSize: "13px", fontWeight: 500 }}>{standalone.name}</span>
                                            <span style={{ fontSize: "12px", color: "#6d7175" }}>{standalone.url}</span>
                                          </div>
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
                                              {shopifyCollections.map((col) => (
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
                              groups.flatMap((g: any) => g.variants).map((prod: any, prodIdx: number) => {
                                const pathKey = `${catName}::standalone::${prodIdx}`;
                                const isChecked = selectedProducts.includes(pathKey);
                                return (
                                  <div key={pathKey} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleProductSelectToggle(pathKey)}
                                      style={{ cursor: "pointer" }}
                                    />
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                      <span style={{ fontSize: "13px", fontWeight: 500 }}>{prod.name}</span>
                                      <span style={{ fontSize: "12px", color: "#6d7175" }}>{prod.url}</span>
                                    </div>
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
                <div style={{ display: "flex", gap: "8px", marginTop: "20px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleBulkImportAndCreateCategories}
                    disabled={selectedProducts.length === 0}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "none",
                      background: selectedProducts.length === 0 
                        ? "#e1e3e5" 
                        : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                      color: selectedProducts.length === 0 ? "#8c9196" : "white",
                      cursor: selectedProducts.length === 0 ? "not-allowed" : "pointer",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                    }}
                  >
                    🚀 Bulk Import & Create Categories ({selectedProducts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQueueSelected()}
                    disabled={selectedProducts.length === 0}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      background: selectedProducts.length === 0 ? "#f6f6f7" : "white",
                      color: selectedProducts.length === 0 ? "#8c9196" : "#202223",
                      cursor: selectedProducts.length === 0 ? "not-allowed" : "pointer"
                    }}
                  >
                    Queue Products Without Collection
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProducts([])}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      background: "white",
                      color: "#202223",
                      cursor: "pointer"
                    }}
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}
          </s-section>
        </>
      )}

      {/* Stage 3: Publish Queue */}
      {activeTab === "queue" && (
        <div style={{ width: "100%" }}>
          {/* Global Queue Progress Banner */}
          {queuedSources.length > 0 && (() => {
            const total = queuedSources.length;
            const published = queuedSources.filter(s => s.name.startsWith("✓")).length;
            const failed = queuedSources.filter(s => s.status === "failed").length;
            const remaining = total - published - failed;
            const pct = total > 0 ? Math.round((published / total) * 100) : 0;

            return (
              <div style={{
                width: "100%",
                background: "white",
                border: "1px solid #e1e3e5",
                borderRadius: "12px",
                padding: "16px 20px",
                marginBottom: "20px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                boxSizing: "border-box"
              }}>
                <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: "#e6f4ea",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "18px"
                    }}>
                      📈
                    </div>
                    <div>
                      <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#202223", margin: 0 }}>Queue Progress Overview</h3>
                      <p style={{ fontSize: "12px", color: "#6d7175", margin: 0 }}>Monitor catalog extraction and Shopify publishing jobs</p>
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#137333" }}>
                      ✓ {published} Published
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#c5221f" }}>
                      ⚠️ {failed} Failed
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175" }}>
                      ⏳ {remaining} Remaining
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#008060" }}>
                      {pct}% Complete
                    </span>
                  </div>
                </div>

                {/* Progress track */}
                <div style={{
                  width: "100%",
                  height: "8px",
                  background: "#f1f2f4",
                  borderRadius: "4px",
                  overflow: "hidden"
                }}>
                  <div style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #008060 0%, #34d399 100%)",
                    borderRadius: "4px",
                    transition: "width 0.4s ease"
                  }} />
                </div>
              </div>
            );
          })()}

          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "stretch", width: "100%" }}>
          {/* Left Column: Queue Dashboard & Table */}
          <div style={{ flex: "1 1 48%", minWidth: "500px" }}>
            <s-section heading="🗂 Queue & Auto-Publish dashboard">
              <div style={{
                background: "#f0f4f9",
                borderLeft: "4px solid #006fbb",
                padding: "12px 16px",
                borderRadius: "0 8px 8px 0",
                marginBottom: "16px",
                fontSize: "13px",
                color: "#202223",
                lineHeight: "1.5"
              }}>
                <strong style={{ display: "block", marginBottom: "4px" }}>💡 Step 3 Publishing Guide:</strong>
                1. Here is your ingestion queue. Click <strong>View</strong> next to any item in the table to display its parsed details in the preview panel.<br />
                2. Review the <strong>🤖 AI Schema</strong> to verify title, SKU, and specifications. Go to the <strong>📝 Markdown</strong> tab if you wish to edit the raw extracted text.<br />
                3. Click <strong>Review & Publish</strong> to adjust collection assignments, check/uncheck fields to overwrite, and create the product in your Shopify store.
              </div>

              <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "15px", flexWrap: "wrap" }}>
                <button 
                  type="button"
                  onClick={() => setIsProcessingQueue(!isProcessingQueue)}
                  disabled={!queuedSources.some(s => ["queued", "converting"].includes(s.status)) && !isProcessingQueue}
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    borderRadius: "6px",
                    border: "none",
                    background: !queuedSources.some(s => ["queued", "converting"].includes(s.status)) && !isProcessingQueue
                      ? "#e1e3e5"
                      : isProcessingQueue
                        ? "linear-gradient(135deg, #d32f2f 0%, #9a0007 100%)"
                        : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                    color: !queuedSources.some(s => ["queued", "converting"].includes(s.status)) && !isProcessingQueue
                      ? "#8c9196"
                      : "white",
                    cursor: !queuedSources.some(s => ["queued", "converting"].includes(s.status)) && !isProcessingQueue
                      ? "not-allowed"
                      : "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                  }}
                >
                  {isProcessingQueue ? "Pause Processing" : "Start Processing Queue"}
                </button>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button 
                    type="button"
                    onClick={() => {
                      if (manualPublishCount === 0) {
                        alert("Please manually review and publish at least one product to verify data accuracy before enabling Auto-Publish.");
                        return;
                      }
                      setIsAutoPublishing(!isAutoPublishing);
                    }}
                    title={manualPublishCount === 0 ? "You must manually publish at least one product first to verify data accuracy." : ""}
                    disabled={manualPublishCount === 0 || (!queuedSources.some(s => ["queued", "converting", "ready"].includes(s.status) && !s.name.startsWith("✓")) && !isAutoPublishing)}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "none",
                      background: (manualPublishCount === 0 || (!queuedSources.some(s => ["queued", "converting", "ready"].includes(s.status) && !s.name.startsWith("✓")) && !isAutoPublishing))
                        ? "#e1e3e5"
                        : isAutoPublishing
                          ? "linear-gradient(135deg, #d32f2f 0%, #9a0007 100%)"
                          : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                      color: (manualPublishCount === 0 || (!queuedSources.some(s => ["queued", "converting", "ready"].includes(s.status) && !s.name.startsWith("✓")) && !isAutoPublishing))
                        ? "#8c9196"
                        : "white",
                      cursor: (manualPublishCount === 0 || (!queuedSources.some(s => ["queued", "converting", "ready"].includes(s.status) && !s.name.startsWith("✓")) && !isAutoPublishing))
                        ? "not-allowed"
                        : "pointer",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                    }}
                  >
                    {isAutoPublishing ? "Pause Auto-Publish" : "Start Auto-Publish"}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setQueuedSources([])}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      background: "white",
                      color: "#202223",
                      cursor: "pointer"
                    }}
                  >
                    Clear All
                  </button>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    if (confirm("Clear all queued sources and session data?")) {
                      setQueuedSources([]);
                      setCrawlResult(null);
                      setCustomCollections([]);
                      setSelectedSourceId(null);
                      setIsProcessingQueue(false);
                      localStorage.removeItem("ingest_ai_session");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    borderRadius: "6px",
                    border: "1px solid #c9cccf",
                    background: "white",
                    color: "#202223",
                    cursor: "pointer"
                  }}
                >
                  Clear Session
                </button>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>Delay (ms):</span>
                  <input 
                    type="number" 
                    value={throttleDelay} 
                    onChange={(e) => setThrottleDelay(Number(e.target.value))}
                    min="500" 
                    step="500"
                    style={{ width: "80px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "13px" }}
                  />
                </div>
              </div>

              {queuedSources.length === 0 ? (
                <div style={{ textAlign: "center", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #c9cccf", padding: "24px" }}>
                  <p style={{ color: "#6d7175", fontSize: "14px", margin: 0 }}>Queue is empty. Go to "Crawl & Categorize" tab to select and queue products.</p>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                      <th style={{ padding: "8px", fontSize: "13px", fontWeight: 600, color: "#202223" }}>Source Name</th>
                      <th style={{ padding: "8px", fontSize: "13px", fontWeight: 600, color: "#202223" }}>Type</th>
                      <th style={{ padding: "8px", fontSize: "13px", fontWeight: 600, color: "#202223" }}>Status</th>
                      <th style={{ padding: "8px", fontSize: "13px", fontWeight: 600, color: "#202223" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queuedSources.map((source) => (
                      <tr 
                        key={source.id} 
                        style={{ 
                          borderBottom: "1px solid #eee", 
                          background: selectedSourceId === source.id ? "#eaf5f0" : "transparent"
                        }}
                      >
                        <td style={{ padding: "8px" }}>
                          <button
                            type="button"
                            onClick={() => setSelectedSourceId(source.id)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#006fbb",
                              cursor: "pointer",
                              padding: 0,
                              textDecoration: "underline",
                              fontSize: "13px",
                              fontWeight: 500,
                              textAlign: "left"
                            }}
                          >
                            {source.name}
                          </button>
                        </td>
                        <td style={{ padding: "8px", fontSize: "13px", color: "#202223" }}>{source.type.toUpperCase()}</td>
                        <td style={{ padding: "8px" }}>
                          {(() => {
                            let bg = "#f1f2f4";
                            let border = "1px solid #c9cccf";
                            let color = "#202223";
                            let text = source.status.toUpperCase();
                            let icon = "⏳";
                            let isPulsing = false;

                            if (source.name.startsWith("✓")) {
                              bg = "#e6f4ea";
                              border = "1px solid #c4ebd0";
                              color = "#137333";
                              icon = "✓";
                              text = "PUBLISHED";
                            } else if (source.status === "ready") {
                              bg = "#e6f4ea";
                              border = "1px solid #c4ebd0";
                              color = "#137333";
                              icon = "✓";
                              text = "READY";
                            } else if (source.status === "failed") {
                              bg = "#fbeae5";
                              border = "1px solid #f9d2c4";
                              color = "#c5221f";
                              icon = "⚠️";
                              text = "FAILED";
                            } else if (source.status === "converting" || source.status === "publishing") {
                              bg = "#fff7ed";
                              border = "1px solid #fed7aa";
                              color = "#9a3412";
                              icon = "⚙️";
                              isPulsing = true;
                              text = source.status === "converting" ? "CONVERTING" : "PUBLISHING";
                            }

                            return (
                              <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: bg,
                                border: border,
                                color: color,
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 700,
                                letterSpacing: "0.3px",
                                opacity: isPulsing ? 0.85 : 1,
                              }}>
                                <span>{icon}</span>
                                <span>{text}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              onClick={() => handleOpenReviewModal(source.id)}
                              style={{
                                padding: "4px 10px",
                                fontSize: "12px",
                                fontWeight: 600,
                                borderRadius: "4px",
                                border: "1px solid #008060",
                                background: "#f0fdf4",
                                color: "#008060",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px"
                              }}
                            >
                              👁️ View & Review
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSource(source.id)}
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                fontWeight: 500,
                                borderRadius: "4px",
                                border: "1px solid #f9d2c4",
                                background: "#fbeae5",
                                color: "#c5221f",
                                cursor: "pointer"
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </s-section>
          </div>

          {/* Right Column: Source Preview Section */}
          <div style={{ flex: "1 1 48%", minWidth: "500px" }}>
            <s-section heading={`📝 Preview: ${selectedSource ? selectedSource.name.replace(/^✓ /, "") : "Select a Source"}`}>
              {selectedSource && (
                <div style={{ marginBottom: "12px", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => handleOpenReviewModal(selectedSource.id)}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 700,
                      borderRadius: "6px",
                      border: "none",
                      background: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                      color: "white",
                      cursor: "pointer",
                      boxShadow: "0 2px 6px rgba(0,128,96,0.2)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    🚀 Review & Publish Individual Product
                  </button>
                </div>
              )}
              <div style={{ padding: "4px" }}>
                {selectedSource ? (
                  <div>
                    {selectedSource.status === "converting" && (
                      <div style={{ padding: "16px", textAlign: "center" }}>
                        <s-spinner size="base" accessibility-label="Converting source..."></s-spinner>
                        <p style={{ marginTop: "10px", color: "#6d7175", fontSize: "13px" }}>Converting to Markdown...</p>
                      </div>
                    )}

                    {selectedSource.status === "failed" && (
                      <div style={{ padding: "16px", background: "#fbeae5", borderRadius: "8px", border: "1px solid #f9d2c4", color: "#202223" }}>
                        <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600, color: "#bf0711" }}>Conversion Failed</h4>
                        <p style={{ fontSize: "13px", color: "#bf0711", marginBottom: "10px" }}>{selectedSource.error}</p>
                        <button 
                          type="button"
                          onClick={() => triggerUrlIngestion(selectedSource)}
                          style={{
                            padding: "6px 12px",
                            fontSize: "12px",
                            fontWeight: 600,
                            borderRadius: "4px",
                            border: "1px solid #c9cccf",
                            background: "white",
                            cursor: "pointer"
                          }}
                        >
                          Retry Conversion
                        </button>
                      </div>
                    )}

                    {(selectedSource.status === "ready" || selectedSource.status === "publishing" || selectedSource.name.startsWith("✓")) && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        
                        {isMultiProduct && (
                          <div style={{ padding: "16px", background: "#fffad6", borderRadius: "8px", borderLeft: "4px solid #e0b034", marginBottom: "10px" }}>
                            <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600 }}>⚠️ Multi-Product</h4>
                            <p style={{ fontSize: "13px", color: "#202223", marginBottom: "8px" }}>
                              We've focused on the 1st product schema.
                            </p>
                            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                              <button
                                type="button"
                                onClick={handleScrapeFirstOnly}
                                style={{
                                  padding: "6px 12px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  borderRadius: "4px",
                                  border: "1px solid #c9cccf",
                                  background: "white",
                                  cursor: "pointer"
                                }}
                              >
                                Scrape 1st
                              </button>
                              <button
                                type="button"
                                onClick={handleSplitMultiProducts}
                                style={{
                                  padding: "6px 12px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  borderRadius: "4px",
                                  border: "1px solid #c9cccf",
                                  background: "white",
                                  cursor: "pointer"
                                }}
                              >
                                Scrape All
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Sub-tabs for preview panel */}
                        <div style={{ display: "flex", gap: "5px", borderBottom: "1px solid #e1e3e5", paddingBottom: "0px", marginBottom: "10px" }}>
                          <button
                            type="button"
                            onClick={() => setPreviewSubTab("schema")}
                            style={{
                              padding: "6px 12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              border: "none",
                              background: previewSubTab === "schema" ? "white" : "transparent",
                              color: previewSubTab === "schema" ? "#008060" : "#6d7175",
                              borderBottom: previewSubTab === "schema" ? "2px solid #008060" : "2px solid transparent",
                              cursor: "pointer",
                              transition: "all 0.15s"
                            }}
                          >
                            🤖 AI Schema
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewSubTab("markdown")}
                            style={{
                              padding: "6px 12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              border: "none",
                              background: previewSubTab === "markdown" ? "white" : "transparent",
                              color: previewSubTab === "markdown" ? "#008060" : "#6d7175",
                              borderBottom: previewSubTab === "markdown" ? "2px solid #008060" : "2px solid transparent",
                              cursor: "pointer",
                              transition: "all 0.15s"
                            }}
                          >
                            📝 Markdown
                          </button>
                        </div>

                        {/* Sub-tab 1: Markdown Editor */}
                        {previewSubTab === "markdown" && (
                          <div>
                            {/* Toggle header for preview options */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                              <span style={{ fontSize: "12px", color: "#6d7175" }}>Edit raw extracted product description markdown</span>
                              <div style={{ display: "flex", background: "#f1f2f4", borderRadius: "6px", padding: "2px", border: "1px solid #e1e3e5" }}>
                                <button
                                  type="button"
                                  onClick={() => setShowSplitPreview(false)}
                                  style={{
                                    padding: "4px 10px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    borderRadius: "4px",
                                    border: "none",
                                    background: !showSplitPreview ? "white" : "transparent",
                                    color: !showSplitPreview ? "#202223" : "#6d7175",
                                    cursor: "pointer",
                                    boxShadow: !showSplitPreview ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                                    transition: "all 0.15s ease"
                                  }}
                                >
                                  Editor Only
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowSplitPreview(true)}
                                  style={{
                                    padding: "4px 10px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    borderRadius: "4px",
                                    border: "none",
                                    background: showSplitPreview ? "white" : "transparent",
                                    color: showSplitPreview ? "#202223" : "#6d7175",
                                    cursor: "pointer",
                                    boxShadow: showSplitPreview ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                                    transition: "all 0.15s ease"
                                  }}
                                >
                                  Split Preview
                                </button>
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: "16px", flexDirection: showSplitPreview ? "row" : "column", alignItems: "stretch" }}>
                              <div style={{ flex: 1, minWidth: "200px" }}>
                                <textarea
                                  value={editingMarkdown}
                                  onChange={(e) => setEditingMarkdown(e.target.value)}
                                  style={{
                                    width: "100%",
                                    height: "350px",
                                    padding: "12px",
                                    fontFamily: "monospace",
                                    fontSize: "12px",
                                    borderRadius: "6px",
                                    border: "1px solid #ccc",
                                    boxSizing: "border-box",
                                    lineHeight: "1.5",
                                    resize: "vertical",
                                    background: "white"
                                  }}
                                />
                              </div>
                              {showSplitPreview && (
                                <div style={{
                                  flex: 1,
                                  minWidth: "200px",
                                  height: "350px",
                                  overflowY: "auto",
                                  padding: "16px",
                                  background: "#fafbfb",
                                  border: "1px solid #c9cccf",
                                  borderRadius: "6px",
                                  boxSizing: "border-box"
                                }}>
                                  <div style={{ 
                                    fontSize: "10px", 
                                    fontWeight: 700, 
                                    color: "#008060", 
                                    textTransform: "uppercase", 
                                    letterSpacing: "0.5px", 
                                    marginBottom: "10px", 
                                    borderBottom: "1px solid #e1e3e5", 
                                    paddingBottom: "4px" 
                                  }}>
                                    Shopify HTML Render Preview
                                  </div>
                                  <div 
                                    dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(editingMarkdown) }}
                                    style={{ fontSize: "13px", color: "#202223", lineHeight: "1.6" }}
                                  />
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                              <button 
                                type="button"
                                onClick={() => {
                                  runExtraction(editingMarkdown, selectedSource.domain);
                                  setPreviewSubTab("schema");
                                }}
                                disabled={isExtracting}
                                style={{
                                  width: "100%",
                                  padding: "8px 16px",
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  borderRadius: "6px",
                                  border: "none",
                                  background: isExtracting ? "#e1e3e5" : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                                  color: isExtracting ? "#8c9196" : "white",
                                  cursor: isExtracting ? "not-allowed" : "pointer"
                                }}
                              >
                                Re-run Extraction
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Sub-tab 2: AI Schema Preview */}
                        {previewSubTab === "schema" && (
                          <div>
                            {/* CTA Action Box placed at the very top of Schema Preview */}
                            <div style={{ 
                              padding: "12px", 
                              background: "#f6f6f7", 
                              borderRadius: "8px", 
                              border: "1px solid #e1e3e5", 
                              marginBottom: "15px" 
                            }}>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button 
                                  type="button"
                                  onClick={() => runExtraction(editingMarkdown, selectedSource.domain)}
                                  disabled={isExtracting}
                                  style={{
                                    padding: "8px 12px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    borderRadius: "6px",
                                    border: "1px solid #c9cccf",
                                    background: "white",
                                    color: "#202223",
                                    cursor: isExtracting ? "not-allowed" : "pointer",
                                    flex: 1
                                  }}
                                >
                                  Re-run Extraction
                                </button>
                                <button 
                                  type="button"
                                  onClick={handleOpenReviewModal}
                                  disabled={!extractedProduct}
                                  style={{
                                    padding: "8px 12px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    borderRadius: "6px",
                                    border: "none",
                                    background: !extractedProduct ? "#e1e3e5" : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                                    color: !extractedProduct ? "#8c9196" : "white",
                                    cursor: !extractedProduct ? "not-allowed" : "pointer",
                                    flex: 1.2
                                  }}
                                >
                                  Review & Publish
                                </button>
                              </div>
                            </div>

                            {isExtracting && (
                              <div style={{ padding: "16px", textAlign: "center" }}>
                                <s-spinner size="base" accessibility-label="Extracting fields..."></s-spinner>
                                <p style={{ marginTop: "10px", color: "#6d7175", fontSize: "13px" }}>Extracting fields...</p>
                              </div>
                            )}

                            {!isExtracting && extractedProduct && (
                              <div style={{ padding: "16px", border: "1px solid #e1e3e5", borderRadius: "8px", background: "white" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <strong style={{ fontSize: "13px" }}>Title:</strong>
                                    <span style={{ fontSize: "13px", textAlign: "right" }}>{extractedProduct.title}</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <strong style={{ fontSize: "13px" }}>SKU:</strong>
                                    <span style={{ fontSize: "13px", textAlign: "right" }}>{extractedProduct.sku}</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <strong style={{ fontSize: "13px" }}>RFQ Mode:</strong>
                                    <span style={{
                                      display: "inline-block",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      background: extractedProduct.purchase_type === "quote_only" ? "#fff0b3" : "#e6f4ea",
                                      color: extractedProduct.purchase_type === "quote_only" ? "#8f6b00" : "#137333"
                                    }}>
                                      {extractedProduct.purchase_type === "quote_only" ? "RFQ" : "DIRECT BUY"}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    <strong style={{ fontSize: "13px" }}>Description:</strong>
                                    <p style={{ fontSize: "12px", color: "#5c5f62", lineHeight: "1.4", margin: 0 }}>
                                      {extractedProduct.short_description}
                                    </p>
                                  </div>

                                  <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "8px 0" }} />
                                  
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                    <strong style={{ fontSize: "13px" }}>Specs ({extractedProduct.specifications?.length || 0}):</strong>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newSpecs = [...(extractedProduct.specifications || []), { name: "New Property", rawValue: "Value" }];
                                        setExtractedProduct({ ...extractedProduct, specifications: newSpecs });
                                      }}
                                      style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#008060",
                                        cursor: "pointer",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        padding: 0
                                      }}
                                    >
                                      ＋ Add Row
                                    </button>
                                  </div>
                                  {extractedProduct.specifications && extractedProduct.specifications.length > 0 ? (
                                    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden", background: "white" }}>
                                      {extractedProduct.specifications.map((spec: any, idx: number) => (
                                        <div key={idx} style={{ 
                                          display: "flex", 
                                          alignItems: "center", 
                                          gap: "8px", 
                                          padding: "6px 10px", 
                                          borderBottom: idx < extractedProduct.specifications.length - 1 ? "1px solid #f1f2f4" : "none" 
                                        }}>
                                          <input
                                            type="text"
                                            value={spec.name}
                                            onChange={(e) => {
                                              const newSpecs = [...extractedProduct.specifications];
                                              newSpecs[idx] = { ...newSpecs[idx], name: e.target.value };
                                              setExtractedProduct({ ...extractedProduct, specifications: newSpecs });
                                            }}
                                            style={{
                                              flex: 1,
                                              fontSize: "12px",
                                              fontWeight: 600,
                                              border: "1px solid transparent",
                                              borderRadius: "4px",
                                              padding: "2px 4px",
                                              background: "transparent",
                                              outline: "none"
                                            }}
                                            onFocus={(e) => {
                                              e.target.style.border = "1px solid #008060";
                                              e.target.style.background = "white";
                                            }}
                                            onBlur={(e) => {
                                              e.target.style.border = "1px solid transparent";
                                              e.target.style.background = "transparent";
                                            }}
                                          />
                                          <span style={{ color: "#6d7175" }}>:</span>
                                          <input
                                            type="text"
                                            value={spec.rawValue}
                                            onChange={(e) => {
                                              const newSpecs = [...extractedProduct.specifications];
                                              newSpecs[idx] = { ...newSpecs[idx], rawValue: e.target.value };
                                              setExtractedProduct({ ...extractedProduct, specifications: newSpecs });
                                            }}
                                            style={{
                                              flex: 1.5,
                                              fontSize: "12px",
                                              color: "#4b5563",
                                              border: "1px solid transparent",
                                              borderRadius: "4px",
                                              padding: "2px 4px",
                                              background: "transparent",
                                              outline: "none"
                                            }}
                                            onFocus={(e) => {
                                              e.target.style.border = "1px solid #008060";
                                              e.target.style.background = "white";
                                            }}
                                            onBlur={(e) => {
                                              e.target.style.border = "1px solid transparent";
                                              e.target.style.background = "transparent";
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newSpecs = extractedProduct.specifications.filter((_: any, sIdx: number) => sIdx !== idx);
                                              setExtractedProduct({ ...extractedProduct, specifications: newSpecs });
                                            }}
                                            style={{
                                              border: "none",
                                              background: "transparent",
                                              color: "#c5221f",
                                              cursor: "pointer",
                                              fontSize: "14px",
                                              padding: "2px 6px",
                                              display: "flex",
                                              alignItems: "center"
                                            }}
                                            title="Delete specification"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p style={{ fontSize: "12px", color: "#6d7175", margin: 0 }}>No specifications.</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {!isExtracting && !extractedProduct && (
                              <div style={{ padding: "16px", background: "#f6f6f7", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
                                <p style={{ fontSize: "13px", color: "#6d7175", margin: 0 }}>No extraction data available. Edit the Markdown or re-run parser.</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ fontSize: "36px", marginBottom: "10px" }}>📝</div>
                    <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", margin: "10px 0 6px 0" }}>No Source Selected</h3>
                    <p style={{ fontSize: "13px", color: "#6d7175", lineHeight: "1.4", margin: 0 }}>Select a product source from the queue on the left to preview Markdown and verify AI Schema extraction details.</p>
                  </div>
                )}
              </div>
            </s-section>
          </div>
        </div>
        </div>
      )}




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
                  {queuedSources.find(s => s.id === selectedSourceId)?.existingProductId ? "Review & Update Product" : "Review & Publish Product"}
                </h2>
                <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#6d7175" }}>
                  Configure product details and variant rules before publishing to Shopify.
                </p>
                {queuedSources.find(s => s.id === selectedSourceId)?.existingProductId && (
                  <span style={{ 
                    display: "inline-block",
                    marginTop: "6px",
                    background: "#fee2e2",
                    color: "#991b1b",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 600
                  }}>
                    ⚠️ Update Mode Active
                  </span>
                )}
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
              {selectedSource?.existingProductId && existingProduct && (
                <div style={{
                  background: "#fdf8f6",
                  border: "1px solid #fadcd3",
                  borderRadius: "10px",
                  padding: "16px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.03)"
                }}>
                  <h4 style={{ margin: "0 0 12px 0", color: "#c5221f", fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>⚠️</span> Side-by-Side Update Comparison &amp; Overwrite Rules
                  </h4>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* Title Comparison */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175" }}>Product Title</span>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#c5221f", fontWeight: 600, cursor: "pointer" }}>
                          <input type="checkbox" checked={reviewOverwriteTitle} onChange={e => setReviewOverwriteTitle(e.target.checked)} />
                          Overwrite?
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <div style={{ flex: 1, padding: "8px 10px", background: "#f1f2f4", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: "#5c5f62" }}>
                          <strong>Shopify:</strong> {existingProduct.title}
                        </div>
                        <div style={{ flex: 1, padding: "8px 10px", background: reviewOverwriteTitle ? "#e6f4ea" : "#f1f2f4", border: reviewOverwriteTitle ? "1px solid #c4ebd0" : "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: reviewOverwriteTitle ? "#137333" : "#5c5f62" }}>
                          <strong>AI Extracted:</strong> {reviewTitle}
                        </div>
                      </div>
                    </div>

                    {/* Description Comparison */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175" }}>Description Summary</span>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#c5221f", fontWeight: 600, cursor: "pointer" }}>
                          <input type="checkbox" checked={reviewOverwriteDescription} onChange={e => setReviewOverwriteDescription(e.target.checked)} />
                          Overwrite?
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <div style={{ flex: 1, padding: "8px 10px", background: "#f1f2f4", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: "#5c5f62", maxHeight: "80px", overflowY: "auto" }}>
                          <strong>Shopify:</strong> {existingProduct.description || "(No description)"}
                        </div>
                        <div style={{ flex: 1, padding: "8px 10px", background: reviewOverwriteDescription ? "#e6f4ea" : "#f1f2f4", border: reviewOverwriteDescription ? "1px solid #c4ebd0" : "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: reviewOverwriteDescription ? "#137333" : "#5c5f62", maxHeight: "80px", overflowY: "auto" }}>
                          <strong>AI Extracted:</strong> {reviewDescription}
                        </div>
                      </div>
                    </div>

                    {/* Variants Comparison */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175" }}>Variants &amp; SKU Mapping</span>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#c5221f", fontWeight: 600, cursor: "pointer" }}>
                          <input type="checkbox" checked={reviewOverwriteVariants} onChange={e => setReviewOverwriteVariants(e.target.checked)} />
                          Overwrite?
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <div style={{ flex: 1, padding: "8px 10px", background: "#f1f2f4", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: "#5c5f62" }}>
                          <strong>Shopify ({existingProduct.variants?.length || 0}):</strong>
                          <div style={{ fontSize: "11px", marginTop: "4px", color: "#6d7175" }}>
                            {existingProduct.variants && existingProduct.variants.slice(0, 3).map((v: any) => `${v.title} (${v.sku || "no SKU"})`).join(", ")}
                            {existingProduct.variants && existingProduct.variants.length > 3 && " ..."}
                          </div>
                        </div>
                        <div style={{ flex: 1, padding: "8px 10px", background: reviewOverwriteVariants ? "#e6f4ea" : "#f1f2f4", border: reviewOverwriteVariants ? "1px solid #c4ebd0" : "1px solid #c9cccf", borderRadius: "6px", fontSize: "12px", color: reviewOverwriteVariants ? "#137333" : "#5c5f62" }}>
                          <strong>AI Extracted ({reviewVariants.length || (reviewSku ? 1 : 0)}):</strong>
                          <div style={{ fontSize: "11px", marginTop: "4px", color: reviewOverwriteVariants ? "#137333" : "#6d7175" }}>
                            {reviewVariants.length > 0 
                              ? reviewVariants.slice(0, 3).map((v: any) => `${v.optionValues.map((ov: any) => ov.name).join("/")} (${v.sku || "no SKU"})`).join(", ")
                              : `${reviewTitle} (${reviewSku || "no SKU"})`}
                            {reviewVariants.length > 3 && " ..."}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
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
                              border: reviewHeroImageIdx === idx ? "2px solid #e0b034" : "1px solid #e1e3e5", 
                              borderRadius: "6px", 
                              padding: "4px", 
                              display: "flex", 
                              flexDirection: "column", 
                              alignItems: "center", 
                              backgroundColor: media.selected 
                                ? (reviewHeroImageIdx === idx ? "#fefbeb" : "#f0fdf4") 
                                : "#ffffff", 
                              borderColor: media.selected 
                                ? (reviewHeroImageIdx === idx ? "#e0b034" : "#008060") 
                                : "#e1e3e5",
                              boxShadow: reviewHeroImageIdx === idx ? "0 0 8px rgba(224, 176, 52, 0.2)" : "none",
                              transition: "all 0.2s" 
                            }}
                          >
                            <input 
                              type="checkbox" 
                              checked={media.selected} 
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setReviewMediaLinks(prev => prev.map((m, i) => i === idx ? { ...m, selected: checked } : m));
                                if (!checked && reviewHeroImageIdx === idx) {
                                  // Find first other checked image or default to 0
                                  const firstCheckedIdx = reviewMediaLinks.findIndex((m, i) => m.selected && i !== idx);
                                  setReviewHeroImageIdx(firstCheckedIdx >= 0 ? firstCheckedIdx : 0);
                                }
                              }}
                              style={{ position: "absolute", top: "4px", left: "4px", cursor: "pointer", width: "16px", height: "16px", zIndex: 2 }}
                            />

                            {/* Hero Selector Button */}
                            {media.selected && (
                              <button
                                type="button"
                                onClick={() => setReviewHeroImageIdx(idx)}
                                style={{
                                  position: "absolute",
                                  top: "4px",
                                  right: "4px",
                                  cursor: "pointer",
                                  border: "none",
                                  background: reviewHeroImageIdx === idx ? "#e0b034" : "rgba(0,0,0,0.4)",
                                  color: "white",
                                  borderRadius: "4px",
                                  padding: "2px 6px",
                                  fontSize: "9px",
                                  fontWeight: "bold",
                                  zIndex: 2,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "2px",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                                  transition: "all 0.15s ease"
                                }}
                              >
                                {reviewHeroImageIdx === idx ? "★ Hero" : "☆ Make Hero"}
                              </button>
                            )}

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
                    <s-spinner size="base" accessibility-label="Publishing..."></s-spinner>
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

// Helper to convert basic Markdown to shopify-compatible HTML in real-time
function parseMarkdownToHtml(md: string): string {
  if (!md) return "";
  let html = md;

  // Escape HTML entities to avoid broken preview rendering
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Restore block formatting wrappers (so we don't escape our own tags)
  // Convert code blocks
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre style="background: #f1f2f4; padding: 10px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 12px; margin: 8px 0;"><code>${code}</code></pre>`;
  });

  // Convert headers
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 14px; font-weight: 700; margin-top: 12px; margin-bottom: 6px; color: #202223;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 16px; font-weight: 700; margin-top: 16px; margin-bottom: 8px; color: #202223;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 18px; font-weight: 700; margin-top: 20px; margin-bottom: 10px; color: #202223;">$1</h1>');

  // Convert bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert italics
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Convert lists
  const lines = html.split('\n');
  let inList = false;
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const listContent = trimmed.substring(2);
      let out = "";
      if (!inList) {
        inList = true;
        out += '<ul style="margin: 6px 0; padding-left: 20px; list-style-type: disc;">';
      }
      out += `<li style="margin: 4px 0; line-height: 1.4;">${listContent}</li>`;
      return out;
    } else {
      let out = "";
      if (inList) {
        inList = false;
        out += '</ul>';
      }
      if (trimmed.length > 0 && !trimmed.startsWith('&lt;h') && !trimmed.startsWith('&lt;pre') && !trimmed.startsWith('&lt;ul') && !trimmed.startsWith('&lt;li') && !trimmed.startsWith('<pre') && !trimmed.startsWith('<h') && !trimmed.startsWith('<ul') && !trimmed.startsWith('<li')) {
        return `${out}<p style="margin: 8px 0; line-height: 1.5; color: #202223;">${trimmed}</p>`;
      }
      return out + line;
    }
  });

  if (inList) {
    processedLines.push('</ul>');
  }

  return processedLines.join('\n');
}
