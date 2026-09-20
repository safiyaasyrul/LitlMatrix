import { PrismaFlowData, PrismaExclusionReasonItem } from "../types/slr";

export interface PrismaSvgOptions {
  showAuditBadges?: boolean;
  scale?: number;
}

const escapeXml = (value: string | number | null | undefined): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const countLabel = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "(not assessed)";
  return `(n = ${Math.max(0, value)})`;
};

/**
 * Generate PRISMA 2020 Flow Diagram SVG string adhering to the official PRISMA 2020 standard.
 */
export function buildPrismaSvg(data: PrismaFlowData, _options: PrismaSvgOptions = {}): string {
  const { identification, removedBeforeScreening, screening, eligibility, included } = data;

  const width = 1180;
  // Compute dynamic height based on whether eligibility stage is full or compact
  const hasEligibility =
    eligibility.reportsSought !== null ||
    eligibility.reportsAssessed !== null ||
    eligibility.exclusionReasons.length > 0;

  const height = hasEligibility ? 1280 : 980;

  const leftX = 140;
  const rightX = 640;
  const boxWidth = 460;

  const stageHeaderX = 25;
  const stageHeaderWidth = 85;

  const identY = 40;
  const screenY = 280;
  const eligSoughtY = 480;
  const eligAssessY = 640;
  const inclY = hasEligibility ? 980 : 700;

  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="1.75" marker-end="url(#prisma-arrow)"/>`;

  const flowBox = (
    x: number,
    y: number,
    w: number,
    h: number,
    lines: Array<{ text: string; bold?: boolean; small?: boolean; color?: string; count?: string }>,
    options: { fill?: string; stroke?: string; dashed?: boolean } = {}
  ) => {
    const fill = options.fill || "#ffffff";
    const stroke = options.stroke || "#334155";
    const strokeDash = options.dashed ? 'stroke-dasharray="4 3"' : "";
    return `
    <g class="prisma-box">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
        fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${strokeDash}/>
      ${lines
        .map((line, idx) => {
          const fontSize = line.small ? 12.5 : line.bold ? 14.5 : 13.5;
          const fontWeight = line.bold ? "700" : "400";
          const color = line.color || "#0f172a";
          const lineY = y + 26 + idx * 21;
          const textContent = line.count
            ? `${escapeXml(line.text)} <tspan font-weight="600" fill="#1e293b">${escapeXml(line.count)}</tspan>`
            : escapeXml(line.text);
          return `<text x="${x + 16}" y="${lineY}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${textContent}</text>`;
        })
        .join("")}
    </g>`;
  };

  const stageHeader = (y: number, h: number, label: string) => `
    <g class="stage-label">
      <rect x="${stageHeaderX}" y="${y}" width="${stageHeaderWidth}" height="${h}" rx="3" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>
      <text x="${stageHeaderX + stageHeaderWidth / 2}" y="${y + h / 2}" transform="rotate(-90 ${stageHeaderX + stageHeaderWidth / 2} ${y + h / 2})"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#334155" letter-spacing="1">
        ${escapeXml(label.toUpperCase())}
      </text>
    </g>`;

  // 1. Identification Box Lines
  const dbLines = [
    { text: "Records identified from*:", bold: true },
    ...identification.databases.map((db) => ({
      text: `• ${db.name || "Database"}`,
      count: countLabel(db.recordsIdentified),
    })),
    ...(identification.otherSources > 0
      ? [{ text: "• Other sources / Registers", count: countLabel(identification.otherSources) }]
      : []),
  ];
  const identHeight = Math.max(130, 32 + dbLines.length * 21);

  // Removed Before Screening Lines
  const removedLines = [
    { text: "Records removed before screening:", bold: true },
    { text: "• Duplicate records removed", count: countLabel(removedBeforeScreening.duplicates) },
    ...(removedBeforeScreening.automation > 0
      ? [{ text: "• Ineligible by automation tools", count: countLabel(removedBeforeScreening.automation) }]
      : []),
    ...(removedBeforeScreening.otherReasons > 0
      ? [{ text: "• Removed for other reasons", count: countLabel(removedBeforeScreening.otherReasons) }]
      : []),
  ];
  const removedHeight = Math.max(130, 32 + removedLines.length * 21);

  // 2. Screening Box Lines
  const screenedLines = [
    { text: "Records screened", bold: true },
    { text: "Title and abstract review", count: countLabel(screening.recordsScreened) },
  ];
  const screeningExcludedLines = [
    { text: "Records excluded**", bold: true },
    { text: "Excluded during title/abstract screen", count: countLabel(screening.recordsExcluded) },
    ...(screening.unresolved && screening.unresolved > 0
      ? [{ text: "• Awaiting screening decision", count: countLabel(screening.unresolved), small: true }]
      : []),
  ];

  // 3. Eligibility Box Lines (if applicable)
  const soughtLines = [
    { text: "Reports sought for retrieval", bold: true },
    { text: "Full-text retrieval sought", count: countLabel(eligibility.reportsSought ?? screening.recordsScreened - screening.recordsExcluded) },
  ];
  const notRetrievedLines = [
    { text: "Reports not retrieved", bold: true },
    { text: "Full text unavailable / not retrieved", count: countLabel(eligibility.reportsNotRetrieved ?? 0) },
  ];

  const assessedLines = [
    { text: "Reports assessed for eligibility", bold: true },
    { text: "Full-text eligibility assessment", count: countLabel(eligibility.reportsAssessed ?? screening.recordsScreened - screening.recordsExcluded) },
  ];

  const reasonsList = eligibility.exclusionReasons && eligibility.exclusionReasons.length > 0
    ? eligibility.exclusionReasons
    : [{ reason: "Exclusion criteria applied", count: eligibility.reportsExcluded || 0 }];

  const eligExcludedLines = [
    { text: "Reports excluded:", bold: true },
    ...reasonsList.slice(0, 6).map((r: PrismaExclusionReasonItem) => ({
      text: `• ${r.reason}`,
      count: countLabel(r.count),
      small: true,
    })),
  ];
  const eligExcludedHeight = Math.max(110, 34 + eligExcludedLines.length * 20);

  // 4. Included Box Lines
  const includedLines = [
    { text: "Studies included in review", bold: true },
    { text: "• Total included studies", count: countLabel(included.studiesIncluded) },
    { text: "• Included in qualitative / thematic synthesis", count: countLabel(included.studiesIncludedInSynthesis) },
    ...(included.studiesIncludedInMetaAnalysis !== null && included.studiesIncludedInMetaAnalysis !== undefined
      ? [{ text: "• Included in quantitative meta-analysis", count: countLabel(included.studiesIncludedInMetaAnalysis) }]
      : []),
  ];
  const includedHeight = Math.max(110, 34 + includedLines.length * 21);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="PRISMA 2020 Flow Diagram">
  <defs>
    <marker id="prisma-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <polygon points="0 0, 9 4.5, 0 9" fill="#334155" />
    </marker>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    </style>
  </defs>

  <!-- Background Canvas -->
  <rect width="${width}" height="${height}" fill="#ffffff" />

  <!-- Stage Labels (Left Bar) -->
  ${stageHeader(identY, 210, "Identification")}
  ${stageHeader(screenY, hasEligibility ? 370 : 380, "Screening")}
  ${hasEligibility ? stageHeader(eligSoughtY, 320, "Eligibility") : ""}
  ${stageHeader(inclY, inclY === 700 ? 220 : 240, "Included")}

  <!-- STAGE 1: IDENTIFICATION -->
  ${flowBox(leftX, identY, boxWidth, identHeight, dbLines)}
  ${flowBox(rightX, identY, boxWidth, removedHeight, removedLines)}
  ${arrow(leftX + boxWidth, identY + 55, rightX, identY + 55)}
  ${arrow(leftX + boxWidth / 2, identY + identHeight, leftX + boxWidth / 2, screenY)}

  <!-- STAGE 2: SCREENING -->
  ${flowBox(leftX, screenY, boxWidth, 88, screenedLines)}
  ${flowBox(rightX, screenY, boxWidth, 88, screeningExcludedLines)}
  ${arrow(leftX + boxWidth, screenY + 44, rightX, screenY + 44)}

  <!-- STAGE 3: ELIGIBILITY (or direct inclusion if not separate full-text stage) -->
  ${
    hasEligibility
      ? `
  ${arrow(leftX + boxWidth / 2, screenY + 88, leftX + boxWidth / 2, eligSoughtY)}
  ${flowBox(leftX, eligSoughtY, boxWidth, 88, soughtLines)}
  ${flowBox(rightX, eligSoughtY, boxWidth, 88, notRetrievedLines)}
  ${arrow(leftX + boxWidth, eligSoughtY + 44, rightX, eligSoughtY + 44)}
  ${arrow(leftX + boxWidth / 2, eligSoughtY + 88, leftX + boxWidth / 2, eligAssessY)}
  ${flowBox(leftX, eligAssessY, boxWidth, 88, assessedLines)}
  ${flowBox(rightX, eligAssessY, boxWidth, eligExcludedHeight, eligExcludedLines)}
  ${arrow(leftX + boxWidth, eligAssessY + 44, rightX, eligAssessY + 44)}
  ${arrow(leftX + boxWidth / 2, eligAssessY + 88, leftX + boxWidth / 2, inclY)}
  `
      : `
  ${arrow(leftX + boxWidth / 2, screenY + 88, leftX + boxWidth / 2, inclY)}
  `
  }

  <!-- STAGE 4: INCLUDED -->
  ${flowBox(leftX, inclY, boxWidth, includedHeight, includedLines)}

  <!-- Footer Citation Notice -->
  <text x="${leftX}" y="${height - 20}" font-size="11" fill="#64748b" font-style="italic">
    From: Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ 2021;372:n71. doi: 10.1136/bmj.n71
  </text>
</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Export PRISMA diagram as SVG file.
 */
export function exportPrismaSvg(data: PrismaFlowData, filename = "PRISMA_2020_Flow_Diagram.svg"): void {
  const svg = buildPrismaSvg(data);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Export PRISMA diagram as high-resolution PNG image.
 */
export function exportPrismaPng(data: PrismaFlowData, filename = "PRISMA_2020_Flow_Diagram.png"): Promise<void> {
  return new Promise((resolve, reject) => {
    const svg = buildPrismaSvg(data);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const scaleFactor = 2.5; // High-resolution journal export (300 DPI equivalent)
        const canvas = document.createElement("canvas");
        canvas.width = (img.width || 1180) * scaleFactor;
        canvas.height = (img.height || 1280) * scaleFactor;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          return reject(new Error("Could not initialize 2D canvas context."));
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngUrl = canvas.toDataURL("image/png");
        const anchor = document.createElement("a");
        anchor.href = pngUrl;
        anchor.download = filename;
        anchor.click();

        URL.revokeObjectURL(url);
        resolve();
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Export PRISMA diagram as a clean publication PDF document.
 */
export async function exportPrismaPdf(data: PrismaFlowData, filename = "PRISMA_2020_Flow_Diagram.pdf"): Promise<void> {
  const svg = buildPrismaSvg(data);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  const scale = 2.0;
  canvas.width = (img.width || 1180) * scale;
  canvas.height = (img.height || 1280) * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imgDataUri = canvas.toDataURL("image/jpeg", 0.95);
  URL.revokeObjectURL(url);

  // Generate lightweight standards-compliant vector/image PDF blob
  const pdfBlob = createSimplePdfFromImage(imgDataUri, canvas.width, canvas.height);
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const anchor = document.createElement("a");
  anchor.href = pdfUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(pdfUrl);
}

/**
 * Zero-dependency helper to bundle high-res image into a valid single-page PDF document.
 */
function createSimplePdfFromImage(dataUri: string, imgWidth: number, imgHeight: number): Blob {
  // Convert JPEG base64 to binary Uint8Array
  const base64Data = dataUri.split(",")[1];
  const binaryString = atob(base64Data);
  const imgBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    imgBytes[i] = binaryString.charCodeAt(i);
  }

  // Standard A4 portrait in points (595.28 x 841.89)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  const availWidth = pageWidth - margin * 2;
  const availHeight = pageHeight - margin * 2;

  const aspect = imgWidth / imgHeight;
  let renderWidth = availWidth;
  let renderHeight = availWidth / aspect;

  if (renderHeight > availHeight) {
    renderHeight = availHeight;
    renderWidth = availHeight * aspect;
  }

  const posX = margin + (availWidth - renderWidth) / 2;
  const posY = margin + (availHeight - renderHeight) / 2;

  const objects: string[] = [];
  const offsets: number[] = [];

  // PDF Header
  let pdf = "%PDF-1.4\n";

  const addObject = (content: string | Uint8Array) => {
    offsets.push(pdf.length);
    if (typeof content === "string") {
      pdf += `${objects.length + 1} 0 obj\n${content}\nendobj\n`;
    } else {
      const header = `${objects.length + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${content.length} >>\nstream\n`;
      const footer = `\nendstream\nendobj\n`;
      // Convert current text to bytes, append binary image stream, then return
      // We handle string building below
      pdf += header;
      // String representation for offset calculation placeholder
      pdf += footer;
    }
    objects.push(typeof content === "string" ? content : "BINARY_STREAM");
  };

  // Object 1: Catalog
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  // Object 2: Pages
  addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // Object 3: Page
  addObject(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`
  );
  // Object 4: Image XObject
  offsets.push(pdf.length);
  const imgObjHeader = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`;
  const imgObjFooter = `\nendstream\nendobj\n`;
  pdf += imgObjHeader;
  objects.push("IMG");

  // Build binary buffer
  const textEncoder = new TextEncoder();
  const headerBytes = textEncoder.encode(pdf);
  const footerBytes = textEncoder.encode(imgObjFooter);

  // Object 5: Content Stream
  const contentStream = `q\n${renderWidth.toFixed(2)} 0 0 ${renderHeight.toFixed(2)} ${posX.toFixed(2)} ${posY.toFixed(2)} cm\n/Im1 Do\nQ\n`;
  const obj5Header = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;
  const obj5Bytes = textEncoder.encode(obj5Header);

  const obj5Offset = headerBytes.length + imgBytes.length + footerBytes.length;
  offsets.push(obj5Offset);

  // XRef and Trailer
  const xrefOffset = obj5Offset + obj5Bytes.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const xrefBytes = textEncoder.encode(xref);

  // Combine parts into Blob
  return new Blob([headerBytes, imgBytes, footerBytes, obj5Bytes, xrefBytes], { type: "application/pdf" });
}