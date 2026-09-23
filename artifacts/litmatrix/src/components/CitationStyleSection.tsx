import React from "react";
import { CitationStyle } from "../types/slr";
import { CITATION_STYLE_OPTIONS } from "../utils/citationFormatter";
import { CheckCircle2, FileText, ArrowRight } from "lucide-react";

interface CitationStyleSectionProps {
  citationStyle: CitationStyle;
  onCitationStyleChange: (style: CitationStyle) => void;
  onNext: () => void;
}

export default function CitationStyleSection({
  citationStyle,
  onCitationStyleChange,
  onNext,
}: CitationStyleSectionProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/50 p-6 flex items-start gap-4">
          <div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-lg shrink-0 mt-1">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Configure Manuscript Citation Style</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Choose the citation style for your final manuscript. LitMatrix will dynamically process all of the AI-generated references and strictly bind them to your <strong>exact included records</strong> using your required format.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="max-w-xl">
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Select Citation Style
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CITATION_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onCitationStyleChange(option.value)}
                  className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                    citationStyle === option.value
                      ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                      : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer"
                  }`}
                >
                  <span className={`font-semibold ${citationStyle === option.value ? "text-indigo-900" : "text-slate-700"}`}>
                    {option.label}
                  </span>
                  {citationStyle === option.value && (
                    <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <span className="font-semibold block mb-1">Guaranteed Evidence Alignment</span>
              The manuscript engine converts in-text placeholders and builds the final Reference list by pulling directly from your dataset. This guarantees your manuscript is fully consistent with your final screened-in evidence pool.
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md"
        >
          Generate Manuscript
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
