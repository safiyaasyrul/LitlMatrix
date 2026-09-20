import React from "react";
import { CheckCircle2, Info, ArrowRight } from "lucide-react";

interface StepGuidanceProps {
  step: number;
  title: string;
  whatToDo: string;
  whatInfoIsRequired: string;
  whatHappensNext: string;
}

export default function StepGuidance({
  step,
  title,
  whatToDo,
  whatInfoIsRequired,
  whatHappensNext,
}: StepGuidanceProps) {
  return (
    <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="bg-indigo-600 text-white font-mono text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded">
          Step {step}
        </span>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wide">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
            What to do
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{whatToDo}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wide">
            <Info className="w-3.5 h-3.5 text-amber-500" />
            What info is required
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{whatInfoIsRequired}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wide">
            <ArrowRight className="w-3.5 h-3.5 text-emerald-500" />
            What happens next
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{whatHappensNext}</p>
        </div>
      </div>
    </div>
  );
}
