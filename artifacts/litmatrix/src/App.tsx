import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  SLRProtocol,
  SLRRecord,
  ScreeningDecision,
  StudyCharacteristic,
  SynthesisResult,
  DiscussionSections,
  PrismaChecklistItem,
  PrismaSChecklistItem,
  RosesChecklistItem,
} from "./types/slr";
import {
  initialPrismaChecklist,
  initialPrismaSChecklist,
  initialRosesChecklist,
} from "./data/prismaChecklistData";
import {
  sampleProtocol,
  sampleRecords,
  sampleScreening,
  sampleCharacteristics,
  sampleSynthesis,
  sampleDiscussion,
  BLANK_PROTOCOL,
} from "./data/sampleDataset";

import MethodsProtocol from "./components/MethodsProtocol";
import SearchStringsGenerator from "./components/SearchStringsGenerator";
import RecordsImport from "./components/RecordsImport";
import ScreeningSection from "./components/ScreeningSection";
import PrismaDiagram from "./components/PrismaDiagram";
import SynthesisSection from "./components/SynthesisSection";
import DiscussionSection from "./components/DiscussionSection";
import FullReviewReport from "./components/FullReviewReport";
import ApiKeySection from "./components/ApiKeySection";

const neutralDiscussionDefaults: Pick<
  DiscussionSections,
  "item23bLimitationsOfEvidence" | "item23cLimitationsOfReviewProcess" | "item23dImplications"
> = {
  item23bLimitationsOfEvidence:
    "The included studies address the review topic across the identified thematic domains. Differences in methods, settings, and reported outcomes are considered narratively within each cluster and are interpreted according to the findings reported by each study.",
  item23cLimitationsOfReviewProcess:
    "The review applies predefined eligibility criteria and organizes the included evidence into narrative and thematic clusters. The discussion focuses on relationships, contrasts, and recurring patterns that are visible across the included records.",
  item23dImplications:
    "The findings identify recurring themes and areas of convergence across the included records. These themes can inform domain-specific interpretation, practical discussion, and future research priorities grounded in the outcomes reported by the included studies.",
};

const normalizePersistedDiscussion = (saved: DiscussionSections): DiscussionSections => {
  const legacyText = [
    saved.item23bLimitationsOfEvidence,
    saved.item23cLimitationsOfReviewProcess,
    saved.item23dImplications,
  ].join(" ");
  const containsLegacyLimitation = /workspace|application records|supplied citation records do not|not recorded|not documented|not verified|structured map|quantitative estimate|full-text retrieval/i.test(legacyText);

  return containsLegacyLimitation
    ? { ...saved, ...neutralDiscussionDefaults }
    : saved;
};

import {
  UserAIKeysConfig,
  DEFAULT_AI_KEYS_CONFIG,
  getActiveAIConfig,
  SupportedAIProvider,
  isOpenRouterApiKey,
  OPENROUTER_DEFAULT_BASE,
} from "./utils/aiClient";

import {
  FileSpreadsheet,
  Search,
  UploadCloud,
  CheckCircle,
  GitBranch,
  BarChart2,
  BookOpen,
  FileText,
  Sparkles,
  ChevronRight,
  Menu,
  X,
  RotateCcw,
  Check,
  Key,
  FilePlus,
} from "lucide-react";

const boundPersistedScreening = (
  decisions: Record<string, ScreeningDecision>,
  _sourceRecords: SLRRecord[]
) => ({ ...decisions });

export default function App() {
  const hydrationReady = useRef(false);
  // Navigation State
  const [activeStage, setActiveStage] = useState<number>(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Application data states. New workspaces start blank; demonstration content is opt-in.
  const [protocol, setProtocol] = useState<SLRProtocol>(() => {
    const saved = localStorage.getItem("slr_protocol_v1");
    return saved ? JSON.parse(saved) : BLANK_PROTOCOL;
  });

  const [records, setRecords] = useState<SLRRecord[]>(() => {
    const saved = localStorage.getItem("slr_records_v1");
    return saved ? JSON.parse(saved) : [];
  });

  const [dupesRemoved, setDupesRemoved] = useState<number>(() => {
    const saved = localStorage.getItem("slr_dupes_v1");
    return saved ? JSON.parse(saved) : 0;
  });

  const [screening, setScreening] = useState<Record<string, ScreeningDecision>>(() => {
    const saved = localStorage.getItem("slr_screening_v1");
    return saved ? boundPersistedScreening(JSON.parse(saved), records) : {};
  });

  const [characteristics, setCharacteristics] = useState<StudyCharacteristic[]>(() => {
    const saved = localStorage.getItem("slr_chars_v1");
    return saved ? JSON.parse(saved) : [];
  });

  const [synthesis, setSynthesis] = useState<SynthesisResult>(() => {
    const saved = localStorage.getItem("slr_synthesis_v1");
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      ...parsed,
      forestPlotEstimates: [],
      pooledEffectEstimate: undefined,
      heterogeneityDiscussion: parsed.heterogeneityDiscussion?.replace(/I²|p\s*=|pooled/gi, "") || "",
    };
  });

  const [discussion, setDiscussion] = useState<DiscussionSections>(() => {
    const saved = localStorage.getItem("slr_discussion_v1");
    return saved ? normalizePersistedDiscussion(JSON.parse(saved)) : sampleDiscussion;
  });

  const [checklist, setChecklist] = useState<PrismaChecklistItem[]>(() => {
    const saved = localStorage.getItem("slr_checklist_v1");
    return saved ? JSON.parse(saved) : initialPrismaChecklist;
  });

  const [prismaSChecklist, setPrismaSChecklist] = useState<PrismaSChecklistItem[]>(() => {
    const saved = localStorage.getItem("slr_prisma_s_checklist_v1");
    return saved ? JSON.parse(saved) : initialPrismaSChecklist;
  });

  const [rosesChecklist, setRosesChecklist] = useState<RosesChecklistItem[]>(() => {
    const saved = localStorage.getItem("slr_roses_checklist_v1");
    return saved ? JSON.parse(saved) : initialRosesChecklist;
  });

  const [keysConfig, setKeysConfig] = useState<UserAIKeysConfig>(() => {
    const saved = localStorage.getItem("slr_ai_keys_v1");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const merged: UserAIKeysConfig = {
          ...DEFAULT_AI_KEYS_CONFIG,
          ...parsed,
          openai: { ...DEFAULT_AI_KEYS_CONFIG.openai, ...(parsed.openai || {}) },
          claude: { ...DEFAULT_AI_KEYS_CONFIG.claude, ...(parsed.claude || {}) },
          gemini: { ...DEFAULT_AI_KEYS_CONFIG.gemini, ...(parsed.gemini || {}) },
          emergent: { ...DEFAULT_AI_KEYS_CONFIG.emergent, ...(parsed.emergent || {}) },
          replit: { ...DEFAULT_AI_KEYS_CONFIG.replit, ...(parsed.replit || {}) },
          other: { ...DEFAULT_AI_KEYS_CONFIG.other, ...(parsed.other || {}) },
        };

        // One-time migration for browsers that previously auto-selected a saved
        // OpenRouter or direct-provider key. Preserve optional keys, but restore
        // the built-in managed provider as the default.
        const managedDefaultMigrationKey = "slr_managed_ai_default_v1";
        if (!localStorage.getItem(managedDefaultMigrationKey)) {
          merged.activeProvider = "replit-managed";
          localStorage.setItem(managedDefaultMigrationKey, "complete");
          return merged;
        }

        // Migrate configurations saved before direct-provider keys auto-selected
        // themselves. An OpenRouter key is always authoritative, even if it
        // was previously pasted into another provider card.
        const openRouterSource = (
          ["other", "openai", "claude", "gemini", "emergent", "replit"] as const
        ).find((provider) => isOpenRouterApiKey(merged[provider].apiKey));
        if (openRouterSource) {
          merged.other = {
            ...merged.other,
            apiKey: merged[openRouterSource].apiKey,
            model: merged.other.model?.includes("/")
              ? merged.other.model
              : merged[openRouterSource].model?.includes("/")
              ? merged[openRouterSource].model
              : "openai/gpt-4o-mini",
            customBase: OPENROUTER_DEFAULT_BASE,
          };
          merged.activeProvider = "other";
        } else if (merged.activeProvider === "server-gemini" || !merged.activeProvider) {
          const configuredProvider = (
            ["other", "openai", "claude", "gemini", "emergent", "replit"] as const
          ).find((provider) => Boolean(merged[provider].apiKey?.trim()));
          if (configuredProvider) {
            merged.activeProvider = configuredProvider as SupportedAIProvider;
          } else {
            merged.activeProvider = "replit-managed";
          }
        } else if (
          merged.activeProvider !== "replit-managed" &&
          !merged[merged.activeProvider]?.apiKey?.trim()
        ) {
          merged.activeProvider = "replit-managed";
        }

        return merged;
      } catch {
        return DEFAULT_AI_KEYS_CONFIG;
      }
    }
    return DEFAULT_AI_KEYS_CONFIG;
  });

  // Local storage persistence effects
  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_protocol_v1", JSON.stringify(protocol));
  }, [protocol]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_records_v1", JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_dupes_v1", JSON.stringify(dupesRemoved));
  }, [dupesRemoved]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_screening_v1", JSON.stringify(screening));
  }, [screening]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_chars_v1", JSON.stringify(characteristics));
  }, [characteristics]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_synthesis_v1", JSON.stringify(synthesis));
  }, [synthesis]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_discussion_v1", JSON.stringify(discussion));
  }, [discussion]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_checklist_v1", JSON.stringify(checklist));
  }, [checklist]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_prisma_s_checklist_v1", JSON.stringify(prismaSChecklist));
  }, [prismaSChecklist]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_roses_checklist_v1", JSON.stringify(rosesChecklist));
  }, [rosesChecklist]);

  useEffect(() => {
    if (!hydrationReady.current) return;
    localStorage.setItem("slr_ai_keys_v1", JSON.stringify(keysConfig));
  }, [keysConfig]);

  const activeAIConfig = useMemo(() => {
    return getActiveAIConfig(keysConfig);
  }, [keysConfig]);

  // Hydrate the server copy before allowing any debounced save to run.
  useEffect(() => {
    fetch("/api/prisma/workspace", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const saved = result?.snapshot;
        if (saved) {
          setProtocol(saved.protocol ?? BLANK_PROTOCOL);
          setRecords(saved.records ?? []);
          setDupesRemoved(typeof saved.dupesRemoved === "number" ? saved.dupesRemoved : 0);
          setScreening(saved.screening ?? {});
          setCharacteristics(saved.characteristics ?? []);
          setSynthesis(saved.synthesis ?? {
            characteristicsTable: [],
            metaAnalysisCategories: [],
            forestPlotEstimates: [],
            pooledEffectEstimate: undefined,
            heterogeneityDiscussion: "",
          });
          setDiscussion(saved.discussion ?? {
            item23aGeneralInterpretation: "",
            item23bLimitationsOfEvidence: "",
            item23cLimitationsOfReviewProcess: "",
            item23dImplications: "",
          });
          setChecklist(saved.checklist ?? initialPrismaChecklist);
          setPrismaSChecklist(saved.prismaSChecklist ?? initialPrismaSChecklist);
          setRosesChecklist(saved.rosesChecklist ?? initialRosesChecklist);
        }
        hydrationReady.current = true;
      }).catch(() => { hydrationReady.current = true; });
  }, []);

  // PostgreSQL is the durable workspace copy; localStorage remains the
  // offline/migration cache used by the existing workbench.
  useEffect(() => {
    if (!hydrationReady.current) return;
    const timer = window.setTimeout(async () => {
      await fetch("/api/prisma/workspace", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: {
          protocol, records, dupesRemoved, screening, characteristics, synthesis,
          discussion, checklist, prismaSChecklist, rosesChecklist,
        } }),
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [protocol, records, dupesRemoved, screening, characteristics, synthesis, discussion, checklist, prismaSChecklist, rosesChecklist]);

  // Derived included records
  const includedRecords = useMemo(() => {
    return records
      .filter((r) => screening[r.id]?.agreed === true)
      .sort((a, b) => (screening[b.id]?.score || 0) - (screening[a.id]?.score || 0));
  }, [records, screening]);

  // Derived excluded records
  const excludedRecords = useMemo(() => {
    return records.filter((r) => screening[r.id]?.agreed === false);
  }, [records, screening]);

  // Exclusion reasons breakdown for PRISMA Item 16b
  const exclusionReasonsBreakdown = useMemo(() => {
    const acc: Record<string, number> = {};
    const includedIds = new Set(includedRecords.map((record) => record.id));
    records.forEach((r) => {
      if (includedIds.has(r.id)) return;
      const reason = screening[r.id]?.agreed === false
        ? screening[r.id]?.exclusionReason || "Other"
        : "Other";
      acc[reason] = (acc[reason] || 0) + 1;
    });
    return acc;
  }, [records, includedRecords, screening]);

  // PRISMA flow counts are derived only from records and recorded screening decisions.
  // Full-text retrieval/assessment is not tracked by this application.
  const prismaCounts = useMemo(() => {
    const uploadedCount = records.length + (dupesRemoved || 0);
    const afterDedupCount = records.length;
    const includedCount = includedRecords.length;
    const excludedCount = Math.max(0, afterDedupCount - includedCount);
    const databaseBreakdown = records.reduce<Record<string, number>>((breakdown, record) => {
      const sources: string[] = record.databaseSources?.length
        ? record.databaseSources
        : [record.databaseSource || "Other databases"];
      const normalizedSources = Array.from(new Set(sources.map((source) => {
        if (/scopus/i.test(source)) return "Scopus";
        if (/web\s*of\s*science|wos/i.test(source)) return "Web of Science";
        return "Other databases";
      })));
      normalizedSources.forEach((source) => {
        breakdown[source] = (breakdown[source] || 0) + 1;
      });
      return breakdown;
    }, {});

    return {
      uploaded: uploadedCount,
      afterDedup: afterDedupCount,
      identifiedDb: uploadedCount,
      identifiedOther: 0,
      duplicatesRemoved: dupesRemoved || 0,
      screened: afterDedupCount,
      screenedExcluded: excludedCount,
      soughtRetrieval: 0,
      notRetrieved: 0,
      assessed: 0,
      assessedExcluded: 0,
      exclusionReasonsBreakdown,
      included: includedCount,
      databaseBreakdown,
      fullTextAssessmentRecorded: false,
    };
  }, [records, screening, dupesRemoved, includedRecords, excludedRecords, exclusionReasonsBreakdown]);

  // Checklist item update helpers
  const handleUpdateChecklistItem = (itemNumber: string, updates: Partial<PrismaChecklistItem>) => {
    setChecklist((prev) =>
      prev.map((c) => (c.itemNumber === itemNumber ? { ...c, ...updates } : c))
    );
  };

  const handleUpdatePrismaSItem = (itemNumber: string, updates: Partial<PrismaSChecklistItem>) => {
    setPrismaSChecklist((prev) =>
      prev.map((c) => (c.itemNumber === itemNumber ? { ...c, ...updates } : c))
    );
  };

  const handleUpdateRosesItem = (itemNumber: string, updates: Partial<RosesChecklistItem>) => {
    setRosesChecklist((prev) =>
      prev.map((c) => (c.itemNumber === itemNumber ? { ...c, ...updates } : c))
    );
  };

  // Reset to full sample dataset
  const handleResetSample = () => {
    if (window.confirm("Reload complete PRISMA 2020 systematic review dataset (Type 2 Diabetes demo)?")) {
      setProtocol(sampleProtocol);
      setRecords(sampleRecords);
      setDupesRemoved(284);
      setScreening(sampleScreening);
      setCharacteristics(sampleCharacteristics);
      setSynthesis(sampleSynthesis);
      setDiscussion(sampleDiscussion);
      setChecklist(initialPrismaChecklist);
      setPrismaSChecklist(initialPrismaSChecklist);
      setRosesChecklist(initialRosesChecklist);
    }
  };

  // Reset to clean blank review
  const handleStartBlankReview = () => {
    if (
      window.confirm(
        "Start a blank review? This will clear all records, screening decisions, characteristics, and reset the protocol template for your own research topic."
      )
    ) {
      setProtocol(BLANK_PROTOCOL);
      setRecords([]);
      setDupesRemoved(0);
      setScreening({});
      setCharacteristics([]);
      setSynthesis({
        characteristicsTable: [],
        metaAnalysisCategories: [],
        forestPlotEstimates: [],
        pooledEffectEstimate: undefined,
        heterogeneityDiscussion: "",
      });
      setDiscussion({
        item23aGeneralInterpretation: "",
        item23bLimitationsOfEvidence: "",
        item23cLimitationsOfReviewProcess: "",
        item23dImplications: "",
      });
      setChecklist(initialPrismaChecklist);
      setPrismaSChecklist(initialPrismaSChecklist);
      setRosesChecklist(initialRosesChecklist);
    }
  };

  // Keep downstream stages aligned without manufacturing screening or analysis results.
  const handleAutoSyncAllStagesFromRecords = (customRecordsList?: SLRRecord[]) => {
    const targetRecords = customRecordsList || records;
    if (targetRecords.length === 0) {
      alert("No records available to synchronize. Please upload or import bibliographic records first.");
      return;
    }

    const recordIds = new Set(targetRecords.map((record) => record.id));
    setScreening((current) =>
      Object.fromEntries(Object.entries(current).filter(([recordId]) => recordIds.has(recordId)))
    );
    setCharacteristics((current) => current.filter((item) => recordIds.has(item.recordId)));
    setSynthesis({
      subtopics: [],
      keyFindingsTable: [],
      forestPlotEstimates: [],
      pooledEffectEstimate: undefined,
      heterogeneityDiscussion: "",
    });
    setDiscussion({
      item23aGeneralInterpretation: "",
      item23bLimitationsOfEvidence: "",
      item23cLimitationsOfReviewProcess: "",
      item23dImplications: "",
    });
    alert("Records synchronized. Records without screening decisions were not included; no unsupported synthesis results were generated.");
  };

  // Navigation stages mapped to the PRISMA 2020 checklist.
  const stages = [
    {
      id: "ai-keys",
      label: "AI Providers & API Keys",
      badge: "OpenAI, Claude, Gemini",
      icon: Key,
    },
    {
      id: "protocol",
      label: "Protocol & PICO Objectives",
      badge: "Items 4, 5, 8–15",
      icon: FileSpreadsheet,
    },
    {
      id: "search",
      label: "Search Strings & Sources",
      badge: "Items 6 & 7",
      icon: Search,
    },
    {
      id: "import",
      label: "Records & Deduplication",
      badge: "Items 6 & 16a",
      icon: UploadCloud,
    },
    {
      id: "screening",
      label: "Study Selection & Exclusions",
      badge: "Items 8, 16a, 16b",
      icon: CheckCircle,
    },
    {
      id: "diagram",
      label: "PRISMA Flow Diagram",
      badge: "Item 16a",
      icon: GitBranch,
    },
    {
      id: "synthesis",
      label: "Narrative Synthesis",
      badge: "Items 13a–f",
      icon: BarChart2,
    },
    {
      id: "discussion",
      label: "4-Part PRISMA Discussion",
      badge: "Items 23a–23d",
      icon: BookOpen,
    },
    {
      id: "manuscript",
      label: "Consolidated Manuscript",
      badge: "Full Report",
      icon: FileText,
    },
  ];

  // Overall PRISMA compliance count
  const reportedCount = checklist.filter((c) => c.status === "Reported").length;
  const compliancePct = Math.round((reportedCount / 27) * 100);

  return (
    <div id="prisma-workbench-root" className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      {/* Top Application Bar */}
      <header className="bg-white text-slate-900 border-b border-slate-200 px-4 py-3 sm:px-6 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
                <GitBranch className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-slate-900">
                    PRISMA 2020 Workbench
                  </span>
                </div>
                <p className="text-xs text-slate-500 hidden sm:block truncate max-w-md">
                  {protocol.title || "Systematic Literature Review Assistant"}
                </p>
              </div>
            </div>
          </div>

          {/* Right Header Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              <span className="text-xs font-mono text-slate-500">Compliance:</span>
              <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                {compliancePct}% ({reportedCount}/27 Items)
              </span>
            </div>

            <button
              onClick={handleStartBlankReview}
              title="Start a fresh blank systematic review"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-slate-700 bg-white hover:bg-slate-50 hover:text-slate-900 border border-slate-200 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">New Review</span>
            </button>

            <button
              onClick={handleResetSample}
              title="Reset to PRISMA Diabetes Sample Dataset"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden md:inline">Load Demo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace with Sidebar */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        {/* Left Navigation Sidebar */}
        <aside
          className={`fixed lg:sticky top-[57px] left-0 z-20 h-[calc(100vh-57px)] w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Stages List Header */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              PRISMA 2020 Workflow
            </span>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
               {stages.length} Stages
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {stages.map((stage, idx) => {
              const Icon = stage.icon;
              const isActive = activeStage === idx;
              return (
                <button
                  key={stage.id}
                  onClick={() => {
                    setActiveStage(idx);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                    isActive
                      ? "bg-indigo-50 text-indigo-950 font-semibold border border-indigo-100/80 shadow-2xs"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? "text-indigo-600" : "text-slate-400"
                      }`}
                    />
                    <div className="truncate">
                      <div className={`text-xs truncate ${isActive ? "font-semibold text-indigo-950" : "text-slate-700"}`}>{stage.label}</div>
                      <div
                        className={`text-[10px] font-mono ${
                          isActive ? "text-indigo-600 font-medium" : "text-slate-400"
                        }`}
                      >
                        {stage.badge}
                      </div>
                    </div>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/70">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Included Studies:</span>
              <strong className="text-emerald-700 font-mono font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">{includedRecords.length} studies</strong>
            </div>
            <div className="flex items-center justify-between text-xs mt-2">
              <span className="text-slate-500 font-medium">Total Records:</span>
              <strong className="text-slate-700 font-mono">{records.length} records</strong>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Stage 1: AI Providers & API Keys */}
          {activeStage === 0 && (
            <ApiKeySection
              keysConfig={keysConfig}
              onUpdateKeysConfig={setKeysConfig}
              onContinueToNext={() => setActiveStage(1)}
            />
          )}

          {/* Stage 2: Protocol & PICO Objectives */}
          {activeStage === 1 && (
            <MethodsProtocol
              protocol={protocol}
              onUpdateProtocol={setProtocol}
              aiConfig={activeAIConfig}
            />
          )}

          {/* Stage 3: Information Sources & Search Strings */}
          {activeStage === 2 && (
            <SearchStringsGenerator
              protocol={protocol}
              onUpdateProtocol={setProtocol}
              aiConfig={activeAIConfig}
            />
          )}

          {/* Stage 4: Records Import & Deduplication */}
          {activeStage === 3 && (
            <RecordsImport
              records={records}
              onUpdateRecords={setRecords}
              dupesRemoved={dupesRemoved}
              onUpdateDupesRemoved={setDupesRemoved}
              onAutoSyncAllStagesFromRecords={handleAutoSyncAllStagesFromRecords}
            />
          )}

          {/* Stage 5: Study Screening */}
          {activeStage === 4 && (
            <ScreeningSection
              records={records}
              dupesRemoved={dupesRemoved || 0}
              screening={screening}
              onUpdateScreening={setScreening}
              protocol={protocol}
              aiConfig={activeAIConfig}
            />
          )}

          {/* Stage 6: PRISMA 2020 Flow Diagram */}
          {activeStage === 5 && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs">
                <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
                  PRISMA 2020 Item 16a
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-1">
                  PRISMA 2020 Flow Diagram
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Flow of records through identification, title-and-abstract screening, and inclusion using the recorded decisions.
                </p>
              </div>
              <PrismaDiagram counts={prismaCounts} />
            </div>
          )}

          {/* Stage 7: Narrative / Thematic Synthesis */}
          {activeStage === 6 && (
            <SynthesisSection
              protocol={protocol}
              onUpdateProtocol={setProtocol}
              synthesis={synthesis}
              onUpdateSynthesis={setSynthesis}
              includedRecords={includedRecords}
              characteristics={characteristics}
              aiConfig={activeAIConfig}
              onNavigateToScreening={() => setActiveStage(4)}
            />
          )}

          {/* Stage 8: 4-Part Discussion */}
          {activeStage === 7 && (
            <DiscussionSection
              discussion={discussion}
              onUpdateDiscussion={setDiscussion}
              protocol={protocol}
              synthesis={synthesis}
              aiConfig={activeAIConfig}
              includedRecords={includedRecords}
              characteristics={characteristics}
            />
          )}

          {/* Stage 9: Consolidated Manuscript */}
          {activeStage === 8 && (
            <FullReviewReport
              protocol={protocol}
              includedRecords={includedRecords}
              screenedRecords={records}
              screening={screening}
              characteristics={characteristics}
              synthesis={synthesis}
              discussion={discussion}
              checklist={checklist}
              counts={prismaCounts}
            />
          )}

        </main>
      </div>
    </div>
  );
}
