export interface PrismaSvgCounts {
  uploaded: number;
  afterDedup: number;
  duplicatesRemoved: number;
  screened: number;
  screenedExcluded: number;
  unresolved: number;
  included: number;
  identifiedDb?: number;
  identifiedOther?: number;
}

const escapeXml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const countLabel = (value: number) => `(n = ${value})`;

export const buildPrismaSvg = (rawCounts: PrismaSvgCounts) => {
  const counts = {
    ...rawCounts,
    screened: Math.max(0, rawCounts.screened),
    screenedExcluded: Math.max(0, rawCounts.screenedExcluded),
    unresolved: Math.max(0, rawCounts.unresolved),
    included: Math.max(0, rawCounts.included),
  };
  const width = 1450;
  const height = 760;
  const box = {
    x: 330,
    width: 500,
    height: 76,
  };
  const leftX = 60;
  const rightX = 870;
  const identificationY = 110;
  const duplicateY = 230;
  const screeningY = 350;
  const branchY = 500;
  const inclusionY = 645;

  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>`;
  const flowBox = (
    x: number,
    y: number,
    title: string,
    count: number,
    options: { fill?: string; stroke?: string; titleColor?: string; subtitle?: string } = {}
  ) => `
    <g>
      <rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="5"
        fill="${options.fill || "#ffffff"}" stroke="${options.stroke || "#334155"}" stroke-width="1.5"/>
      <text x="${x + 18}" y="${y + 29}" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="${options.titleColor || "#0f172a"}">${escapeXml(title)}</text>
      <text x="${x + 18}" y="${y + 55}" font-family="Arial, sans-serif" font-size="15" fill="#334155">${escapeXml(countLabel(count))}${options.subtitle ? ` · ${escapeXml(options.subtitle)}` : ""}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Adapted PRISMA 2020 flow diagram">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 Z" fill="#475569"/>
    </marker>
    <style>
      text { dominant-baseline: alphabetic; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="60" y="42" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#0f172a">Adapted PRISMA 2020 flow diagram</text>
  <text x="60" y="70" font-family="Arial, sans-serif" font-size="14" fill="#475569">Record flow through identification, deduplication, screening, resolution, and inclusion. Full-text stages are not performed.</text>

  <rect x="${leftX}" y="92" width="220" height="32" rx="4" fill="#0f172a"/>
  <text x="${leftX + 16}" y="114" font-family="Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.2" fill="#ffffff">IDENTIFICATION</text>
  <rect x="${rightX}" y="92" width="220" height="32" rx="4" fill="#4f46e5"/>
  <text x="${rightX + 16}" y="114" font-family="Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.2" fill="#ffffff">SCREENING</text>

  <rect x="${leftX}" y="${identificationY}" width="220" height="76" rx="5" fill="#f8fafc" stroke="#334155" stroke-width="1.5"/>
  <text x="${leftX + 16}" y="${identificationY + 29}" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Records identified</text>
  <text x="${leftX + 16}" y="${identificationY + 55}" font-family="Arial, sans-serif" font-size="15" fill="#334155">${escapeXml(countLabel(counts.uploaded))} from databases</text>
  ${arrow(leftX + 110, identificationY + 76, leftX + 110, duplicateY)}
  <rect x="${leftX}" y="${duplicateY}" width="220" height="76" rx="5" fill="#ffffff" stroke="#334155" stroke-width="1.5"/>
  <text x="${leftX + 16}" y="${duplicateY + 29}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#0f172a">Duplicates removed</text>
  <text x="${leftX + 16}" y="${duplicateY + 55}" font-family="Arial, sans-serif" font-size="15" fill="#334155">${escapeXml(countLabel(counts.duplicatesRemoved))}</text>

  ${arrow(leftX + 220, duplicateY + 38, box.x, screeningY + 38)}
  ${flowBox(box.x, screeningY, "Records screened", counts.screened, { subtitle: "available record information" })}
  ${arrow(box.x + box.width / 2, screeningY + box.height, box.x + box.width / 2, branchY)}

  <path d="M${box.x + 80} ${branchY} H${rightX - 20} V${branchY + 10}" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>
  ${flowBox(rightX, branchY + 10, "Records excluded", counts.screenedExcluded, { fill: "#fff7f7", stroke: "#b91c1c", titleColor: "#991b1b" })}

  <path d="M${box.x + box.width / 2} ${branchY} V${inclusionY - 34}" fill="none" stroke="#475569" stroke-width="2"/>
  ${flowBox(box.x, inclusionY - 10, "Records included", counts.included, { fill: "#f0fdf4", stroke: "#047857", titleColor: "#065f46", subtitle: "final included evidence set" })}

  <path d="M${box.x + box.width - 80} ${branchY} H${rightX - 20} V${branchY + 108}" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>
  ${flowBox(rightX, branchY + 108, "Unresolved records", counts.unresolved, { fill: "#fffbeb", stroke: "#b45309", titleColor: "#92400e", subtitle: "no final include/exclude decision" })}

  <text x="60" y="742" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Counts reconcile after deduplication: screened = excluded + unresolved + included.</text>
</svg>`;
};

export const svgToDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
