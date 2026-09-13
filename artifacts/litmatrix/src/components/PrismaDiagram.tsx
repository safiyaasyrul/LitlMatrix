import React from "react";
import { Download, Layers } from "lucide-react";
import { buildPrismaSvg, PrismaSvgCounts } from "../utils/prismaSvg";

interface PrismaDiagramProps {
  counts: PrismaSvgCounts;
  showActions?: boolean;
}

export default function PrismaDiagram({ counts, showActions = true }: PrismaDiagramProps) {
  const hasRecords = counts.uploaded > 0 || counts.afterDedup > 0 || counts.screened > 0 || counts.included > 0;
  const svg = buildPrismaSvg(counts);

  const downloadSVG = () => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "PRISMA_2020_Flow_Diagram.svg";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = () => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2480;
      canvas.height = 2840;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const anchor = document.createElement("a");
        anchor.href = canvas.toDataURL("image/png");
        anchor.download = "PRISMA_2020_Flow_Diagram.png";
        anchor.click();
      }
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  return (
    <div id="prisma-diagram-container" className="space-y-4">
      {showActions && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50/70 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <span className="font-mono text-xs font-semibold text-slate-800 uppercase tracking-wider">
               PRISMA 2020 · Flow diagram
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadSVG} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Download SVG
            </button>
            <button onClick={downloadPNG} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Export PNG
            </button>
          </div>
        </div>
      )}

      {!hasRecords ? (
        <div className="border border-amber-200 bg-amber-50 p-6 rounded-xl text-center">
           <p className="font-mono text-sm font-semibold text-amber-900">PRISMA counts will appear after records are imported.</p>
           <p className="text-xs text-amber-800 mt-1">Import records to populate the standard flow diagram.</p>
        </div>
      ) : (
        <div className="border border-slate-200 bg-white p-4 sm:p-6 rounded-xl shadow-xs overflow-x-auto">
          <div
            className="min-w-[720px] [&>svg]:w-full [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
}