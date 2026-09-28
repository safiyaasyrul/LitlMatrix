import React, { useRef, useState } from "react";
import { SLRRecord } from "../types/slr";
import { parseUpload, dedupeRecords, exportRecordsToCSV, exportRecordsToRIS } from "../utils/parser";
import {
  UploadCloud,
  FileText,
  Trash2,
  Layers,
  Download,
  CheckCircle,
  Database,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Search,
  PlusCircle,
  Check,
  X,
  BookOpen,
  Filter,
  CheckCheck,
} from "lucide-react";
import { SLRProtocol } from "../types/slr";

interface RecordsImportProps {
  records: SLRRecord[];
  onUpdateRecords: (records: SLRRecord[]) => void;
  dupesRemoved: number | null;
  onUpdateDupesRemoved: (count: number) => void;
  onAutoSyncAllStagesFromRecords?: (customRecordsList?: SLRRecord[]) => void;
  protocol?: SLRProtocol;
  onUpdateProtocol?: (protocol: SLRProtocol) => void;
}

export default function RecordsImport({
  records,
  onUpdateRecords,
  dupesRemoved,
  onUpdateDupesRemoved,
  onAutoSyncAllStagesFromRecords,
  protocol,
  onUpdateProtocol,
}: RecordsImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedFiles, setImportedFiles] = useState<{ name: string; count: number; db: string }[]>([]);
  const [selectedDb, setSelectedDb] = useState<"Scopus" | "Web of Science" | "PubMed" | "Google Scholar" | "IEEE Xplore" | "Cochrane" | "Other">("Scopus");
  const [importMode, setImportMode] = useState<"replace" | "append">("append");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDbFilter, setSelectedDbFilter] = useState<string>("all");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [dedupeModalInfo, setDedupeModalInfo] = useState<{
    removed: number;
    retained: number;
    crossMatches: number;
    mergedGroups: number;
  } | null>(null);

  // Check if current records contain the sample diabetes dataset
  const hasDiabetesSample = records.some(
    (r) =>
      r.id.startsWith("chen-2023") ||
      r.id.startsWith("rodriguez-2024") ||
      r.id.startsWith("zhao-2023") ||
      r.title.toLowerCase().includes("diabetes")
  );

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);
    let allNew: SLRRecord[] = [];
    const newFilesInfo: { name: string; count: number; db: string }[] = [];

    for (const f of arr) {
      const text = await f.text();
      const parsed = parseUpload(f.name, text, selectedDb);
      const fileDb = parsed.length > 0 && parsed[0].databaseSource ? parsed[0].databaseSource : selectedDb;
      newFilesInfo.push({ name: f.name, count: parsed.length, db: fileDb });
      allNew = [...allNew, ...parsed];
    }

    if (allNew.length === 0) {
      alert("No valid records could be parsed from the selected file(s). Please ensure your export is in Web of Science (.txt / savedrecs / .ciw / .bib), Scopus (.ris / .bib / .csv), PubMed (.nbib), or standard RIS format.");
      return;
    }

    if (importMode === "replace") {
      setImportedFiles(newFilesInfo);
      onUpdateRecords(allNew);
      onUpdateDupesRemoved(0);
      if (onAutoSyncAllStagesFromRecords) {
        onAutoSyncAllStagesFromRecords(allNew);
        showToast(`Imported ${allNew.length} record(s). Replaced previous records and synced review stages.`);
      } else {
        showToast(`Imported ${allNew.length} record(s). Replaced previous library records.`);
      }
    } else {
      // Append / Retain existing records mode
      setImportedFiles((prev) => [...prev, ...newFilesInfo]);
      const combined = [...records, ...allNew];
      onUpdateRecords(combined);
      showToast(`Retained existing library and appended ${allNew.length} new record(s). Total library: ${combined.length} records.`);
    }
  };

  const handleDeleteRecord = (id: string) => {
    onUpdateRecords(records.filter((r) => r.id !== id));
  };

  const removeFile = (name: string) => {
    setImportedFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const runDeduplication = () => {
    if (records.length === 0) return;
    const result = dedupeRecords(records);
    onUpdateRecords(result.kept);
    onUpdateDupesRemoved((dupesRemoved || 0) + result.removed);
    
    setDedupeModalInfo({
      removed: result.removed,
      retained: result.kept.length,
      crossMatches: result.crossDatabaseMatches,
      mergedGroups: result.mergedCount,
    });

    showToast(`Deduplication complete: ${result.removed} duplicate(s) removed, ${result.crossDatabaseMatches} cross-database overlap(s) merged.`);
  };

  const clearAllRecordsOnly = () => {
    if (window.confirm("Are you sure you want to clear all imported records from your library?")) {
      onUpdateRecords([]);
      setImportedFiles([]);
      onUpdateDupesRemoved(0);
      showToast("Cleared all records from library.");
    }
  };

  const updateDatabaseYield = (dbName: string, count: number) => {
    if (!protocol || !onUpdateProtocol) return;
    const sources = [...(protocol.informationSources || [])];
    const idx = sources.findIndex((s) => s.name.toLowerCase().includes(dbName.toLowerCase()));
    if (idx >= 0) {
      sources[idx] = { ...sources[idx], recordsRetrieved: Math.max(0, count) };
    } else {
      sources.push({
        name: dbName,
        recordsRetrieved: Math.max(0, count),
        lastSearchedDate: new Date().toISOString().split("T")[0],
        urlOrHost: `${dbName.toLowerCase().replace(/\s+/g, "")}.com`,
      });
    }
    onUpdateProtocol({
      ...protocol,
      informationSources: sources,
    });
  };

  // Database breakdown calculations
  const dbCounts = records.reduce((acc, r) => {
    const db = r.databaseSource || "Other";
    acc[db] = (acc[db] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const hasMultipleDatabases = Object.keys(dbCounts).length > 1 || records.some((r) => (r.databaseSource || "").includes(","));

  const filteredRecords = records.filter((r) => {
    const matchesSearch = searchQuery.trim()
      ? r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.authors.some((a) => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.abstract && r.abstract.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.databaseSource && r.databaseSource.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;

    if (!matchesSearch) return false;

    if (selectedDbFilter === "all") return true;
    if (selectedDbFilter === "multi") {
      return (r.databaseSource || "").includes(",") || (r.databaseSources && r.databaseSources.length > 1);
    }
    return (r.databaseSource || "").toLowerCase().includes(selectedDbFilter.toLowerCase());
  });

  return (
    <div id="records-import-container" className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl flex items-center justify-between shadow-xs animate-fade-in font-mono text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Deduplication Summary Banner / Modal */}
      {dedupeModalInfo && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-indigo-900 text-sm">
              <CheckCheck className="w-4 h-4 text-indigo-600" />
              Cross-Database Deduplication Results (PRISMA Item 16a)
            </div>
            <button
              onClick={() => setDedupeModalInfo(null)}
              className="text-indigo-600 hover:text-indigo-900 cursor-pointer p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
            <div className="p-2.5 bg-white border border-indigo-100 rounded-lg">
              <div className="text-[10px] text-slate-500">Duplicates Removed</div>
              <div className="text-base font-bold text-rose-600">{dedupeModalInfo.removed}</div>
            </div>
            <div className="p-2.5 bg-white border border-indigo-100 rounded-lg">
              <div className="text-[10px] text-slate-500">Unique Studies Retained</div>
              <div className="text-base font-bold text-emerald-600">{dedupeModalInfo.retained}</div>
            </div>
            <div className="p-2.5 bg-white border border-indigo-100 rounded-lg">
              <div className="text-[10px] text-slate-500">Co-Indexed Across Databases</div>
              <div className="text-base font-bold text-indigo-600">{dedupeModalInfo.crossMatches}</div>
            </div>
            <div className="p-2.5 bg-white border border-indigo-100 rounded-lg">
              <div className="text-[10px] text-slate-500">Merged Overlap Groups</div>
              <div className="text-base font-bold text-slate-900">{dedupeModalInfo.mergedGroups}</div>
            </div>
          </div>
          <p className="text-[11px] text-indigo-800 font-sans">
            Records found across multiple sources (such as Scopus and Web of Science) have been merged to retain the richest abstract, confirmed DOIs, full author rosters, and multi-database provenance tags.
          </p>
        </div>
      )}

      {/* Notice if sample dataset is currently loaded */}
      {hasDiabetesSample && (
        <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs text-indigo-950 shadow-2xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block text-indigo-950">
                Sample Demonstration Dataset is currently active ({records.length} records)
              </strong>
              <span className="text-indigo-800">
                To run your systematic review on your custom topic, drop your <strong>Web of Science</strong> (savedrecs.txt), <strong>Scopus</strong> (.ris, .bib, .csv), or <strong>PubMed</strong> files below. Select <em>"Replace Existing Records"</em> to start clean, or <em>"Append & Retain"</em> to merge citations from multiple databases.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAllRecordsOnly}
              className="px-3 py-1.5 font-mono font-medium text-xs text-rose-700 bg-white hover:bg-rose-50 border border-indigo-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              Clear Demo Records
            </button>
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
              PRISMA 2020 Items 6 & 16a
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
              Bibliographic Records Library & Multi-Database Importer
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Supports <strong>Web of Science</strong> (Plain text savedrecs, Tab-delimited, RIS, BibTeX), <strong>Scopus</strong> (RIS, BibTeX, CSV), <strong>PubMed</strong> (NBIB, Medline), and standard citation formats.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {records.length > 0 && (
              <button
                onClick={clearAllRecordsOnly}
                className="px-3 py-1.5 text-xs font-mono text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              >
                Clear Records ({records.length})
              </button>
            )}
          </div>
        </div>

        {/* PRISMA Initial Search Yields (Item 6) */}
        {protocol && onUpdateProtocol && (
          <div className="p-4 bg-slate-50/90 border border-slate-200 rounded-xl space-y-3 font-mono text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-slate-800 uppercase tracking-wide">
                  PRISMA 2020 Initial Search Yields (Item 6 Identification)
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-sans">
                State raw search hits from Scopus and Web of Science for your PRISMA Flow Diagram
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                  <span className="flex items-center gap-1"><Database className="w-3 h-3 text-orange-600" /> Scopus Yield (n):</span>
                  <span className="text-[10px] text-slate-400">Elsevier</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={protocol.informationSources.find(s => /scopus/i.test(s.name))?.recordsRetrieved || ""}
                  placeholder="e.g. 340"
                  onChange={(e) => updateDatabaseYield("Scopus", parseInt(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs font-mono font-bold text-slate-900 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                  <span className="flex items-center gap-1"><Database className="w-3 h-3 text-indigo-600" /> Web of Science Yield (n):</span>
                  <span className="text-[10px] text-slate-400">Clarivate</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={protocol.informationSources.find(s => /web of science|wos/i.test(s.name))?.recordsRetrieved || ""}
                  placeholder="e.g. 210"
                  onChange={(e) => updateDatabaseYield("Web of Science", parseInt(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs font-mono font-bold text-slate-900 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-indigo-100 shadow-2xs flex flex-col justify-between">
                <div className="text-[11px] text-slate-600 font-medium">Total Stated Search Yield</div>
                <div className="text-base font-bold text-indigo-700">
                  {protocol.informationSources.reduce((s, i) => s + (i.recordsRetrieved || 0), 0)} citations
                </div>
                <div className="text-[10px] text-slate-400 font-sans">Feeds into Step 11: PRISMA 2020 Flow Diagram</div>
              </div>
            </div>
          </div>
        )}

        {/* Import Mode Selector: Replace vs Append */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-slate-700 uppercase tracking-wider">
              Upload Retention Mode:
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {importMode === "append"
                ? "Retains existing citations (ideal for combining Scopus + Web of Science)"
                : "Replaces current collection with newly uploaded file"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => setImportMode("append")}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                importMode === "append"
                  ? "bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-500/20 shadow-2xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === "append"}
                  onChange={() => setImportMode("append")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                    Append & Retain Data (Multi-Database: Scopus + WoS + PubMed)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Retains your existing database citations and merges new uploads together for cross-database deduplication.
                  </p>
                </div>
              </div>
            </div>

            <div
              onClick={() => setImportMode("replace")}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                importMode === "replace"
                  ? "bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-500/20 shadow-2xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
                    Replace All Existing Records
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Clears previously loaded records and keeps only the new file(s).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Database Origin Picker */}
        <div className="flex flex-wrap items-center gap-3 p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl">
          <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Database className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-mono font-semibold text-slate-700">
            Default Database Source (Auto-detected per file):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(["Scopus", "Web of Science", "PubMed", "Google Scholar", "IEEE Xplore", "Cochrane", "Other"] as const).map((db) => (
              <button
                key={db}
                onClick={() => setSelectedDb(db)}
                className={`px-2.5 py-1 text-xs font-mono rounded-lg transition-colors cursor-pointer ${
                  selectedDb === db
                    ? "bg-slate-900 text-white font-semibold shadow-2xs"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {db}
              </button>
            ))}
          </div>
        </div>

        {/* Dropzone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-indigo-200 bg-indigo-50/20 hover:bg-indigo-50/40 p-8 text-center rounded-xl cursor-pointer transition-colors"
        >
          <UploadCloud className="w-8 h-8 text-indigo-600 mx-auto mb-2" />
          <div className="font-mono text-sm font-semibold text-slate-900">
            Drop .TXT, .RIS, .BIB, .CSV, or .NBIB Export Files Here
          </div>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            Supports multi-file selection (e.g. drop both <strong>scopus.ris</strong> and <strong>savedrecs.txt</strong> together). Auto-detects Web of Science and Scopus.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ris,.bib,.bibtex,.txt,.csv,.tsv,.ciw,.nbib,.medline"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Uploaded Files Chips */}
        {importedFiles.length > 0 && (
          <div className="space-y-2 pt-1">
            <span className="text-xs font-mono text-slate-500 font-semibold">Imported Files ({importedFiles.length}):</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {importedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs shadow-2xs">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="font-mono truncate text-slate-800 font-medium">{f.name}</span>
                    <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                      {f.db}: {f.count} recs
                    </span>
                  </div>
                  <button onClick={() => removeFile(f.name)} className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Database Distribution & Deduplication Actions */}
      {records.length > 0 && (
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold rounded-lg">
                {records.length} Total Records in Library
              </span>
              {dupesRemoved !== null && dupesRemoved > 0 && (
                <span className="font-mono text-xs px-2.5 py-1 bg-rose-50 border border-rose-200 text-rose-800 font-semibold rounded-lg">
                  {dupesRemoved} Duplicates Excluded
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {onAutoSyncAllStagesFromRecords && (
                <button
                  onClick={() => {
                    onAutoSyncAllStagesFromRecords();
                    showToast("Successfully synchronized all PRISMA stages with your uploaded records!");
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                  title="Keep screening, extraction, synthesis, and discussion stages aligned with your uploaded records"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Auto-Sync All Stages with Uploaded Records
                </button>
              )}
              <button
                onClick={runDeduplication}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors cursor-pointer"
                title="Deduplicate library across Scopus and Web of Science by exact DOI and normalized title"
              >
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                Deduplicate Library (PRISMA Item 16a)
              </button>
              <button
                onClick={() => {
                  const csv = exportRecordsToCSV(records);
                  const blob = new Blob([csv], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "systematic_review_records.csv";
                  a.click();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={() => {
                  const ris = exportRecordsToRIS(records);
                  const blob = new Blob([ris], { type: "application/x-research-info-systems" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "systematic_review_records.ris";
                  a.click();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export RIS
              </button>
            </div>
          </div>

          {/* Database Breakdown Chips */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-slate-500 font-semibold">
                Records Breakdown by Source Database (PRISMA Item 6):
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Click a database pill below to filter records
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {Object.entries(dbCounts).map(([db, count]) => (
                <div
                  key={db}
                  onClick={() => setSelectedDbFilter(selectedDbFilter === db ? "all" : db)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedDbFilter === db
                      ? "bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-500/20"
                      : "bg-slate-50/70 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="font-mono text-[11px] text-slate-500 truncate">{db}</div>
                  <div className="font-mono text-base font-bold text-slate-900 mt-0.5">{count} records</div>
                </div>
              ))}
            </div>
          </div>

          {/* Search, Filter & Records Preview List */}
          <div className="pt-2 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-slate-600 font-semibold">
                  Library Studies ({filteredRecords.length} of {records.length}):
                </span>
                {selectedDbFilter !== "all" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full flex items-center gap-1 font-semibold">
                    Filtered by: {selectedDbFilter}
                    <button onClick={() => setSelectedDbFilter("all")} className="hover:text-indigo-950 cursor-pointer">
                      ×
                    </button>
                  </span>
                )}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search title, author, or keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs font-sans pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredRecords.map((r) => {
                const isMultiSource = (r.databaseSource || "").includes(",") || (r.databaseSources && r.databaseSources.length > 1);
                return (
                  <div
                    key={r.id}
                    className="p-3.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50/60 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="font-bold text-sm text-slate-900 leading-snug">{r.title}</div>
                      <div className="text-xs text-slate-500 font-sans flex items-center gap-2 flex-wrap">
                        <span>{(r.authors || []).join(", ") || "Unknown authors"}</span>
                        <span>·</span>
                        <span>{r.year || "Year N/A"}</span>
                        <span>·</span>
                        <span>{r.source || "Journal / Source"}</span>
                        {r.doi && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-[11px] text-indigo-600">DOI: {r.doi}</span>
                          </>
                        )}
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            isMultiSource
                              ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                              : r.databaseSource === "Web of Science"
                              ? "bg-amber-100 text-amber-900 border border-amber-200"
                              : r.databaseSource === "Scopus"
                              ? "bg-sky-100 text-sky-900 border border-sky-200"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {r.databaseSource || "Database"}
                        </span>
                      </div>
                      {r.abstract && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed font-sans">
                          {r.abstract}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteRecord(r.id)}
                      title="Remove this record from library"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}

              {filteredRecords.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500 font-mono">
                  No records matching "{searchQuery}".
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
