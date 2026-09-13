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
  soughtRetrieval?: number;
  notRetrieved?: number;
  assessed?: number;
  assessedExcluded?: number;
  exclusionReasonsBreakdown?: Record<string, number>;
}

const escapeXml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const countLabel = (value: number | undefined) => `(n = ${Math.max(0, value ?? 0)})`;

export const buildPrismaSvg = (rawCounts: PrismaSvgCounts) => {
  const counts = {
    ...rawCounts,
    identifiedDb: Math.max(0, rawCounts.identifiedDb ?? rawCounts.uploaded),
    identifiedOther: Math.max(0, rawCounts.identifiedOther ?? 0),
    soughtRetrieval: Math.max(0, rawCounts.soughtRetrieval ?? 0),
    notRetrieved: Math.max(0, rawCounts.notRetrieved ?? 0),
    assessed: Math.max(0, rawCounts.assessed ?? 0),
    assessedExcluded: Math.max(0, rawCounts.assessedExcluded ?? 0),
    screened: Math.max(0, rawCounts.screened),
    screenedExcluded: Math.max(0, rawCounts.screenedExcluded),
    included: Math.max(0, rawCounts.included),
  };
  const width = 1240;
  const height = 1420;
  const leftX = 125;
  const rightX = 690;
  const boxWidth = 475;
  const identificationY = 45;
  const screeningY = 340;
  const soughtY = 515;
  const assessedY = 690;
  const inclusionY = 1045;

  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>`;

  const flowBox = (
    x: number,
    y: number,
    width: number,
    height: number,
    lines: Array<{ text: string; emphasis?: boolean; color?: string }>,
    options: { fill?: string; stroke?: string } = {},
  ) => `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2"
        fill="${options.fill || "#ffffff"}" stroke="${options.stroke || "#334155"}" stroke-width="1.5"/>
      ${lines.map((line, index) => `<text x="${x + 18}" y="${y + 30 + index * 25}" font-family="Arial, sans-serif" font-size="${line.emphasis ? 18 : 16}" font-weight="${line.emphasis ? 700 : 400}" fill="${line.color || "#111827"}">${escapeXml(line.text)}</text>`).join("")}
    </g>`;

  const identifiedLines = [
    { text: "Records identified from*:", emphasis: true },
    { text: `Databases ${countLabel(counts.identifiedDb)}` },
    { text: `Registers ${countLabel(counts.identifiedOther)}` },
  ];

  const removedLines = [
    { text: "Records removed before screening:", emphasis: true },
    { text: `Duplicate records removed ${countLabel(counts.duplicatesRemoved)}` },
    { text: `Records marked as ineligible by automation ${countLabel(0)}` },
    { text: `Records removed for other reasons ${countLabel(0)}` },
  ];

  const recordedReasons = Object.entries(counts.exclusionReasonsBreakdown || {})
    .filter(([, count]) => count > 0)
    .slice(0, 5)
    .map(([reason, count]) => ({ text: `${reason} ${countLabel(count)}` }));
  const assessedExclusionLines = [
    { text: "Reports excluded:", emphasis: true },
    ...(recordedReasons.length
      ? recordedReasons
      : [{ text: `Reasons not recorded ${countLabel(counts.assessedExcluded)}` }]),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="PRISMA 2020 flow diagram">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 Z" fill="#334155"/>
    </marker>
    <style>
      text { dominant-baseline: alphabetic; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#ffffff"/>

  <rect x="28" y="30" width="62" height="260" rx="7" fill="#dbeafe" stroke="#93c5fd"/>
  <text x="59" y="165" transform="rotate(-90 59 165)" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">Identification</text>
  <rect x="28" y="320" width="62" height="840" rx="7" fill="#dbeafe" stroke="#93c5fd"/>
  <text x="59" y="740" transform="rotate(-90 59 740)" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">Screening</text>
  <rect x="28" y="1190" width="62" height="190" rx="7" fill="#dbeafe" stroke="#93c5fd"/>
  <text x="59" y="1285" transform="rotate(-90 59 1285)" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">Included</text>

  ${flowBox(leftX, identificationY, boxWidth, 155, identifiedLines)}
  ${flowBox(rightX, identificationY, boxWidth, 225, removedLines)}
  ${arrow(leftX + boxWidth / 2, identificationY + 155, leftX + boxWidth / 2, screeningY)}
  ${arrow(leftX + boxWidth, identificationY + 78, rightX, identificationY + 78)}

  ${flowBox(leftX, screeningY, boxWidth, 100, [
    { text: "Records screened", emphasis: true },
    { text: countLabel(counts.screened) },
  ])}
  ${flowBox(rightX, screeningY, boxWidth, 100, [
    { text: "Records excluded**", emphasis: true },
    { text: countLabel(counts.screenedExcluded) },
  ])}
  ${arrow(leftX + boxWidth, screeningY + 50, rightX, screeningY + 50)}

  ${flowBox(leftX, soughtY, boxWidth, 100, [
    { text: "Reports sought for retrieval", emphasis: true },
    { text: countLabel(counts.soughtRetrieval) },
  ])}
  ${flowBox(rightX, soughtY, boxWidth, 100, [
    { text: "Reports not retrieved", emphasis: true },
    { text: countLabel(counts.notRetrieved) },
  ])}
  ${arrow(leftX + boxWidth / 2, screeningY + 100, leftX + boxWidth / 2, soughtY)}
  ${arrow(leftX + boxWidth, soughtY + 50, rightX, soughtY + 50)}

  ${flowBox(leftX, assessedY, boxWidth, 100, [
    { text: "Reports assessed for eligibility", emphasis: true },
    { text: countLabel(counts.assessed) },
  ])}
  ${flowBox(rightX, assessedY, boxWidth, 205, assessedExclusionLines)}
  ${arrow(leftX + boxWidth / 2, soughtY + 100, leftX + boxWidth / 2, assessedY)}
  ${arrow(leftX + boxWidth, assessedY + 50, rightX, assessedY + 50)}

  ${flowBox(leftX, inclusionY, boxWidth, 140, [
    { text: "Studies included in review", emphasis: true },
    { text: countLabel(counts.included) },
    { text: "Reports of included studies", emphasis: true },
    { text: countLabel(counts.included) },
  ])}
  ${arrow(leftX + boxWidth / 2, assessedY + 100, leftX + boxWidth / 2, inclusionY)}
</svg>`;
};

export const svgToDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;