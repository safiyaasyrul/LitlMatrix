import React, { useState, useMemo } from "react";
import {
  Download,
  RotateCcw,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  FileText,
  HelpCircle,
  X,
  Plus,
  Trash2,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { PrismaFlowData, PrismaDatabaseSource, PrismaExclusionReasonItem } from "../types/slr";
import {
  buildPrismaSvg,
  exportPrismaSvg,
  exportPrismaPng,
  exportPrismaPdf,
} from "../utils/prismaSvg";
import {
  validatePrismaFlowData,
  ValidationIssue,
} from "../utils/prismaFlowCalculator";

interface PrismaDiagramProps {
  data: PrismaFlowData;
  onUpdateOverrides?: (overrides: PrismaFlowData["manualOverrides"] | undefined) => void;
  onRegenerate?: () => void;
  onNavigateToManuscript?: () => void;
  showActions?: boolean;
}

export default function PrismaDiagram({
  data,
  onUpdateOverrides,
  onRegenerate,
  onNavigateToManuscript,
  showActions = true,
}: PrismaDiagramProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedAuditField, setSelectedAuditField] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Edit modal state
  const [editDatabases, setEditDatabases] = useState<PrismaDatabaseSource[]>(() =>
    data.identification.databases.map((db) => ({ ...db }))
  );
  const [editOtherSources, setEditOtherSources] = useState<number>(data.identification.otherSources || 0);
  const [editDuplicates, setEditDuplicates] = useState<number>(data.removedBeforeScreening.duplicates || 0);
  const [editAutomation, setEditAutomation] = useState<number>(data.removedBeforeScreening.automation || 0);
  const [editOtherReasons, setEditOtherReasons] = useState<number>(data.removedBeforeScreening.otherReasons || 0);
  const [editScreened, setEditScreened] = useState<number>(data.screening.recordsScreened || 0);
  const [editScreenedExcluded, setEditScreenedExcluded] = useState<number>(data.screening.recordsExcluded || 0);

  // Eligibility edit fields
  const [enableEligibility, setEnableEligibility] = useState<boolean>(
    data.eligibility.reportsSought !== null || data.eligibility.reportsAssessed !== null
  );
  const [editReportsSought, setEditReportsSought] = useState<number | null>(data.eligibility.reportsSought);
  const [editReportsNotRetrieved, setEditReportsNotRetrieved] = useState<number | null>(data.eligibility.reportsNotRetrieved);
  const [editReportsAssessed, setEditReportsAssessed] = useState<number | null>(data.eligibility.reportsAssessed);
  const [editExclusionReasons, setEditExclusionReasons] = useState<PrismaExclusionReasonItem[]>(() =>
    data.eligibility.exclusionReasons.map((r) => ({ ...r }))
  );

  const [editIncluded, setEditIncluded] = useState<number>(data.included.studiesIncluded || 0);
  const [editSynthesis, setEditSynthesis] = useState<number>(data.included.studiesIncludedInSynthesis || 0);

  // Open edit modal and sync fields
  const handleOpenEdit = () => {
    setEditDatabases(data.identification.databases.map((db) => ({ ...db })));
    setEditOtherSources(data.identification.otherSources || 0);
    setEditDuplicates(data.removedBeforeScreening.duplicates || 0);
    setEditAutomation(data.removedBeforeScreening.automation || 0);
    setEditOtherReasons(data.removedBeforeScreening.otherReasons || 0);
    setEditScreened(data.screening.recordsScreened || 0);
    setEditScreenedExcluded(data.screening.recordsExcluded || 0);
    setEnableEligibility(data.eligibility.reportsSought !== null || data.eligibility.reportsAssessed !== null);
    setEditReportsSought(data.eligibility.reportsSought);
    setEditReportsNotRetrieved(data.eligibility.reportsNotRetrieved);
    setEditReportsAssessed(data.eligibility.reportsAssessed);
    setEditExclusionReasons(data.eligibility.exclusionReasons.map((r) => ({ ...r })));
    setEditIncluded(data.included.studiesIncluded || 0);
    setEditSynthesis(data.included.studiesIncludedInSynthesis || 0);
    setIsEditModalOpen(true);
  };

  // Live validation
  const validationIssues = useMemo(() => validatePrismaFlowData(data), [data]);
  const hasErrors = validationIssues.some((i) => i.type === "error");

  const svgString = useMemo(() => buildPrismaSvg(data), [data]);

  // Exports
  const handleDownloadSVG = () => {
    exportPrismaSvg(data, `PRISMA_2020_${data.reviewId || "flow_diagram"}.svg`);
  };

  const handleDownloadPNG = async () => {
    try {
      setIsExporting(true);
      await exportPrismaPng(data, `PRISMA_2020_${data.reviewId || "flow_diagram"}.png`);
    } catch (err) {
      console.error("PNG export error:", err);
      alert("Failed to export PNG. Please try SVG download.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      setIsExporting(true);
      await exportPrismaPdf(data, `PRISMA_2020_${data.reviewId || "flow_diagram"}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Failed to export PDF. Please try SVG or PNG download.");
    } finally {
      setIsExporting(false);
    }
  };

  // Save manual overrides
  const handleSaveOverrides = () => {
    if (!onUpdateOverrides) return;

    const totalEligExcluded = editExclusionReasons.reduce((sum, r) => sum + Math.max(0, r.count), 0);

    const newOverrides: PrismaFlowData["manualOverrides"] = {
      databases: editDatabases.filter((db) => db.name.trim()),
      otherSources: Math.max(0, editOtherSources),
      duplicates: Math.max(0, editDuplicates),
      automation: Math.max(0, editAutomation),
      otherReasons: Math.max(0, editOtherReasons),
      recordsScreened: Math.max(0, editScreened),
      recordsExcluded: Math.max(0, editScreenedExcluded),
      reportsSought: enableEligibility ? Math.max(0, editReportsSought ?? 0) : null,
      reportsNotRetrieved: enableEligibility ? Math.max(0, editReportsNotRetrieved ?? 0) : null,
      reportsAssessed: enableEligibility ? Math.max(0, editReportsAssessed ?? 0) : null,
      reportsExcluded: enableEligibility ? totalEligExcluded : 0,
      exclusionReasons: enableEligibility ? editExclusionReasons.filter((r) => r.reason.trim()) : [],
      studiesIncluded: Math.max(0, editIncluded),
      studiesIncludedInSynthesis: Math.min(100, Math.max(0, editSynthesis)),
    };

    onUpdateOverrides(newOverrides);
    setIsEditModalOpen(false);
  };

  const handleResetToAuto = () => {
    if (window.confirm("Regenerate PRISMA counts from actual review workflow data? This will reset manual adjustments.")) {
      if (onUpdateOverrides) onUpdateOverrides(undefined);
      if (onRegenerate) onRegenerate();
      setIsEditModalOpen(false);
    }
  };

  const handleCopyFigureCaption = () => {
    const caption = "Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process.";
    navigator.clipboard.writeText(caption);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2500);
  };

  return (
    <div id="prisma-2020-workbench-module" className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200 p-5 sm:p-6 rounded-xl shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono text-[11px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                PRISMA 2020
              </span>
              <span className="text-xs font-mono text-slate-500">Item 16a Guideline Compliant</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1.5 tracking-tight">
              PRISMA 2020 Flow Diagram
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Automatically generated from the LitMatrix review workflow (bounded detailed evidence limit: 100).
            </p>
          </div>

          {showActions && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                id="btn-edit-prisma"
                onClick={handleOpenEdit}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                <span>Edit PRISMA Data</span>
              </button>

              <button
                id="btn-regenerate-prisma"
                onClick={handleResetToAuto}
                title="Recalculate diagram counts directly from review database"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Regenerate</span>
              </button>

              <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

              <button
                id="btn-download-svg"
                onClick={handleDownloadSVG}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>SVG</span>
              </button>

              <button
                id="btn-download-png"
                onClick={handleDownloadPNG}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PNG (300 DPI)</span>
              </button>

              <button
                id="btn-download-pdf"
                onClick={handleDownloadPDF}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-300" />
                <span>Download PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Validation Alert */}
        {validationIssues.length > 0 && (
          <div
            className={`mt-4 p-3.5 rounded-lg border text-xs font-mono flex items-start gap-2.5 ${
              hasErrors
                ? "bg-rose-50 border-rose-200 text-rose-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${hasErrors ? "text-rose-600" : "text-amber-600"}`} />
            <div className="space-y-1">
              <span className="font-semibold">
                {hasErrors ? "PRISMA Consistency Issues Detected:" : "Workflow Advisories:"}
              </span>
              <ul className="list-disc list-inside space-y-0.5">
                {validationIssues.map((issue, idx) => (
                  <li key={idx}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Main Flow Diagram Display Container */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-slate-700">
              Journal-Ready Academic Layout
            </span>
            <span className="text-[11px] font-mono text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded">
              Standard: PRISMA 2020 Statement
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 text-xs font-mono">
              <button
                onClick={() => setZoomLevel((z) => Math.max(50, z - 15))}
                className="p-1 text-slate-600 hover:bg-slate-100 rounded"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-slate-600 font-medium">{zoomLevel}%</span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(150, z + 15))}
                className="p-1 text-slate-600 hover:bg-slate-100 rounded"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel(100)}
                className="p-1 text-slate-600 hover:bg-slate-100 rounded ml-1"
                title="Reset Zoom"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={handleCopyFigureCaption}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              {copiedNotification ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">Caption Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy Figure Caption</span>
                </>
              )}
            </button>

            {onNavigateToManuscript && (
              <button
                onClick={onNavigateToManuscript}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Insert in Manuscript</span>
              </button>
            )}
          </div>
        </div>

        {/* Diagram Area */}
        <div className="p-4 sm:p-8 bg-[#ffffff] overflow-x-auto flex justify-center">
          <div
            style={{ width: `${zoomLevel}%`, minWidth: "760px", maxWidth: "1200px" }}
            className="transition-all duration-150 [&>svg]:w-full [&>svg]:h-auto shadow-2xs border border-slate-100 rounded-lg p-2"
            dangerouslySetInnerHTML={{ __html: svgString }}
          />
        </div>

        {/* Figure Caption Block */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-700 font-serif">
          <p className="font-semibold text-slate-900">
            Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process.
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-sans">
            Generated from LitMatrix systematic review ledger ({data.identification.databases.map((d) => `${d.name}: n = ${d.recordsIdentified}`).join(", ")}; Bounded evidence set: n = {data.included.studiesIncludedInSynthesis}).
          </p>
        </div>
      </div>

      {/* Audit Trail Inspector Drawer / Grid */}
      {data.auditTrail && Object.keys(data.auditTrail).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-slate-800">
                PRISMA 2020 Numerical Audit Trail
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Click any count to inspect exact pipeline provenance
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(data.auditTrail).map(([key, entry]) => {
              const isSelected = selectedAuditField === key;
              return (
                <div
                  key={key}
                  onClick={() => setSelectedAuditField(isSelected ? null : key)}
                  className={`p-3.5 rounded-lg border text-xs transition-all cursor-pointer ${
                    isSelected
                      ? "bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-500/20"
                      : "bg-slate-50/60 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wide">
                      {entry.label}
                    </span>
                    <strong className="font-mono text-sm text-slate-900">
                      {entry.value !== null ? `n = ${entry.value}` : "null"}
                    </strong>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-1">
                    <span className="text-indigo-600 font-semibold font-mono">Source:</span>
                    <span>{entry.source}</span>
                  </div>
                  {isSelected && (
                    <p className="text-[11px] text-slate-700 mt-2 pt-2 border-t border-indigo-200/60 font-sans leading-relaxed">
                      {entry.details}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-base text-slate-900">Edit PRISMA 2020 Flow Counts</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Adjust counts manually or specify custom exclusion categories. Changes update the diagram immediately.
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs font-mono">
              {/* 1. Identification Stage */}
              <div className="space-y-3 p-4 bg-slate-50/80 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    1. Identification (Databases & Registers)
                  </span>
                  <button
                    onClick={() => setEditDatabases([...editDatabases, { name: "Database", recordsIdentified: 0 }])}
                    className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold"
                  >
                    <Plus className="w-3 h-3" /> Add Database
                  </button>
                </div>

                <div className="space-y-2">
                  {editDatabases.map((db, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={db.name}
                        onChange={(e) => {
                          const updated = [...editDatabases];
                          updated[idx].name = e.target.value;
                          setEditDatabases(updated);
                        }}
                        placeholder="Database name (e.g. Scopus, WoS)"
                        className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                      <input
                        type="number"
                        min="0"
                        value={db.recordsIdentified}
                        onChange={(e) => {
                          const updated = [...editDatabases];
                          updated[idx].recordsIdentified = Math.max(0, parseInt(e.target.value) || 0);
                          setEditDatabases(updated);
                        }}
                        className="w-28 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                      {editDatabases.length > 1 && (
                        <button
                          onClick={() => setEditDatabases(editDatabases.filter((_, i) => i !== idx))}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-slate-600 block mb-1">Other sources / Registers:</label>
                    <input
                      type="number"
                      min="0"
                      value={editOtherSources}
                      onChange={(e) => setEditOtherSources(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Duplicates removed:</label>
                    <input
                      type="number"
                      min="0"
                      value={editDuplicates}
                      onChange={(e) => setEditDuplicates(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Screening Stage */}
              <div className="space-y-3 p-4 bg-slate-50/80 border border-slate-200 rounded-xl">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  2. Screening (Title & Abstract)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-600 block mb-1">Records screened:</label>
                    <input
                      type="number"
                      min="0"
                      value={editScreened}
                      onChange={(e) => setEditScreened(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Screening exclusions:</label>
                    <input
                      type="number"
                      min="0"
                      value={editScreenedExcluded}
                      onChange={(e) => setEditScreenedExcluded(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Eligibility Stage */}
              <div className="space-y-3 p-4 bg-slate-50/80 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    3. Eligibility & Retrieval (Optional Full-Text Stage)
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                    <input
                      type="checkbox"
                      checked={enableEligibility}
                      onChange={(e) => setEnableEligibility(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    <span>Include Eligibility Stage</span>
                  </label>
                </div>

                {enableEligibility ? (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-slate-600 block mb-1">Reports sought:</label>
                        <input
                          type="number"
                          min="0"
                          value={editReportsSought ?? 0}
                          onChange={(e) => setEditReportsSought(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block mb-1">Not retrieved:</label>
                        <input
                          type="number"
                          min="0"
                          value={editReportsNotRetrieved ?? 0}
                          onChange={(e) => setEditReportsNotRetrieved(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block mb-1">Reports assessed:</label>
                        <input
                          type="number"
                          min="0"
                          value={editReportsAssessed ?? 0}
                          onChange={(e) => setEditReportsAssessed(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700 font-semibold text-[11px]">Exclusion Reasons Breakdown:</span>
                        <button
                          onClick={() => setEditExclusionReasons([...editExclusionReasons, { reason: "Wrong outcome", count: 0 }])}
                          className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Add Reason
                        </button>
                      </div>

                      {editExclusionReasons.map((r, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={r.reason}
                            onChange={(e) => {
                              const updated = [...editExclusionReasons];
                              updated[idx].reason = e.target.value;
                              setEditExclusionReasons(updated);
                            }}
                            placeholder="Reason (e.g. Wrong intervention)"
                            className="flex-1 px-3 py-1 bg-white border border-slate-200 rounded-md text-xs"
                          />
                          <input
                            type="number"
                            min="0"
                            value={r.count}
                            onChange={(e) => {
                              const updated = [...editExclusionReasons];
                              updated[idx].count = Math.max(0, parseInt(e.target.value) || 0);
                              setEditExclusionReasons(updated);
                            }}
                            className="w-20 px-3 py-1 bg-white border border-slate-200 rounded-md text-xs"
                          />
                          <button
                            onClick={() => setEditExclusionReasons(editExclusionReasons.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-600 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    Eligibility stage is set to null (screening flows directly from title/abstract to inclusion).
                  </p>
                )}
              </div>

              {/* 4. Included Stage */}
              <div className="space-y-3 p-4 bg-slate-50/80 border border-slate-200 rounded-xl">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  4. Included Studies & Synthesis (Max: 100)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-600 block mb-1">Studies included in review:</label>
                    <input
                      type="number"
                      min="0"
                      value={editIncluded}
                      onChange={(e) => setEditIncluded(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Studies in thematic synthesis (max 100):</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editSynthesis}
                      onChange={(e) => setEditSynthesis(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={handleResetToAuto}
                className="text-xs text-rose-700 hover:text-rose-900 font-semibold"
              >
                Reset to Auto Workflow
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveOverrides}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
                >
                  Apply Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}