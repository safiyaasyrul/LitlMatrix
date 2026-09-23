export interface CharacteristicGroup {
  heading: string;
  values: { label: string; count: number }[];
}

export interface ThematicTopic {
  title: string;
  count: number;
}

const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
    }
    return c;
  });
};

const wordWrap = (text: string, maxChars: number) => {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + word).length > maxChars) {
      if (current) lines.push(current.trim());
      current = word + " ";
    } else {
      current += word + " ";
    }
  }
  if (current) lines.push(current.trim());
  return lines;
};

export const buildConceptualFrameworkSvg = (groups: CharacteristicGroup[], title: string = "Evidence-Based Conceptual Framework") => {
  const width = 1200;
  const height = 800;
  
  // Professional palette
  const bg = "#ffffff";
  const textDark = "#1e293b"; // slate-800
  const textMuted = "#64748b"; // slate-500
  const boxBg = "#f8fafc"; // slate-50
  const boxBorder = "#cbd5e1"; // slate-300
  const headerBg = "#e2e8f0"; // slate-200
  const accent = "#3b82f6"; // blue-500
  const arrowColor = "#94a3b8"; // slate-400
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`;
  
  // Title
  svg += `<text x="${width / 2}" y="60" font-size="28" font-weight="bold" fill="${textDark}" text-anchor="middle">${escapeXml(title)}</text>`;
  svg += `<text x="${width / 2}" y="90" font-size="16" fill="${textMuted}" text-anchor="middle">Data-driven mapping of methodological dimensions across the included evidence</text>`;
  
  const colCount = Math.max(1, groups.length);
  const colWidth = (width - 100) / colCount;
  
  groups.forEach((group, i) => {
    const x = 50 + i * colWidth;
    const y = 140;
    const boxW = colWidth - 40;
    
    // Column connecting arrows
    if (i < colCount - 1) {
      const startX = x + boxW + 5;
      const endX = x + colWidth - 5;
      const midY = height / 2;
      svg += `<path d="M ${startX} ${midY} L ${endX - 10} ${midY}" stroke="${arrowColor}" stroke-width="3" stroke-dasharray="6,6" fill="none"/>`;
      svg += `<polygon points="${endX},${midY} ${endX - 12},${midY - 6} ${endX - 12},${midY + 6}" fill="${arrowColor}"/>`;
    }
    
    // Draw column container
    const boxH = height - 200;
    svg += `<rect x="${x + 20}" y="${y}" width="${boxW}" height="${boxH}" rx="12" fill="${boxBg}" stroke="${boxBorder}" stroke-width="2"/>`;
    
    // Header
    svg += `<rect x="${x + 20}" y="${y}" width="${boxW}" height="60" rx="12" fill="${headerBg}"/>`;
    svg += `<rect x="${x + 20}" y="${y + 40}" width="${boxW}" height="20" fill="${headerBg}"/>`; // Cover bottom radii
    svg += `<path d="M ${x + 20} ${y + 60} L ${x + 20 + boxW} ${y + 60}" stroke="${boxBorder}" stroke-width="2"/>`;
    svg += `<text x="${x + 20 + boxW / 2}" y="${y + 36}" font-size="20" font-weight="bold" fill="${textDark}" text-anchor="middle">${escapeXml(group.heading)}</text>`;
    
    // Values
    let curY = y + 90;
    const items = group.values.slice(0, 7); // max 7 items
    items.forEach((item) => {
      // Small card for each value
      const cardW = boxW - 40;
      const lines = wordWrap(item.label, 26);
      const cardH = 30 + lines.length * 20;
      
      svg += `<rect x="${x + 40}" y="${curY}" width="${cardW}" height="${cardH}" rx="6" fill="#ffffff" stroke="${boxBorder}" stroke-width="1"/>`;
      
      // Blue accent strip
      svg += `<rect x="${x + 40}" y="${curY}" width="6" height="${cardH}" rx="3" fill="${accent}"/>`;
      svg += `<rect x="${x + 43}" y="${curY}" width="3" height="${cardH}" fill="${accent}"/>`;
      
      lines.forEach((line, li) => {
        svg += `<text x="${x + 55}" y="${curY + 24 + li * 20}" font-size="14" fill="${textDark}" font-weight="500">${escapeXml(line)}</text>`;
      });
      
      // Count badge
      svg += `<rect x="${x + 40 + cardW - 35}" y="${curY + cardH / 2 - 12}" width="26" height="24" rx="12" fill="#eff6ff"/>`;
      svg += `<text x="${x + 40 + cardW - 22}" y="${curY + cardH / 2 + 5}" font-size="12" font-weight="bold" fill="${accent}" text-anchor="middle">${item.count}</text>`;
      
      curY += cardH + 15;
    });
    
    if (group.values.length > 7) {
      svg += `<text x="${x + 20 + boxW / 2}" y="${curY + 10}" font-size="13" font-style="italic" fill="${textMuted}" text-anchor="middle">+ ${group.values.length - 7} additional dimensions</text>`;
    }
  });
  
  svg += `</svg>`;
  return svg;
};

export const buildThematicRelationshipSvg = (topics: ThematicTopic[], title: string = "Thematic Relationship Diagram") => {
  const width = 1200;
  const height = 800;
  
  const bg = "#ffffff";
  const textDark = "#1e293b";
  const textMuted = "#64748b";
  const lineCol = "#94a3b8";
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`;
  
  svg += `<text x="${width / 2}" y="60" font-size="28" font-weight="bold" fill="${textDark}" text-anchor="middle">${escapeXml(title)}</text>`;
  svg += `<text x="${width / 2}" y="90" font-size="16" fill="${textMuted}" text-anchor="middle">Network of emergent themes synthesized from the included literature</text>`;
  
  const cx = width / 2;
  const cy = height / 2 + 20;
  const r = 280;
  
  // Center node
  svg += `<circle cx="${cx}" cy="${cy}" r="90" fill="#f8fafc" stroke="#3b82f6" stroke-width="4"/>`;
  const titleLines = wordWrap("Included Literature", 16);
  titleLines.forEach((line, li) => {
    const yOff = (li - (titleLines.length - 1)/2) * 24;
    svg += `<text x="${cx}" y="${cy + yOff + 6}" font-size="18" font-weight="bold" fill="${textDark}" text-anchor="middle">${escapeXml(line)}</text>`;
  });
  
  // Satellite nodes
  const tCount = topics.length;
  topics.forEach((topic, i) => {
    const angle = (i * 2 * Math.PI) / tCount - Math.PI / 2;
    const nx = cx + r * Math.cos(angle);
    const ny = cy + r * Math.sin(angle);
    
    // Line from center
    const x1 = cx + 90 * Math.cos(angle);
    const y1 = cy + 90 * Math.sin(angle);
    const x2 = nx - 120 * Math.cos(angle);
    const y2 = ny - 40 * Math.sin(angle);
    
    svg += `<path d="M ${x1} ${y1} Q ${cx + (r/2)*Math.cos(angle)} ${cy + (r/2)*Math.sin(angle)} ${x2} ${y2}" stroke="${lineCol}" stroke-width="2" fill="none" stroke-dasharray="4,4"/>`;
    
    // Arrow head
    const arrAngle = Math.atan2(y2 - cy, x2 - cx);
    svg += `<polygon points="${x2},${y2} ${x2 - 12 * Math.cos(arrAngle - 0.5)},${y2 - 12 * Math.sin(arrAngle - 0.5)} ${x2 - 12 * Math.cos(arrAngle + 0.5)},${y2 - 12 * Math.sin(arrAngle + 0.5)}" fill="${lineCol}"/>`;
    
    // Node box
    svg += `<rect x="${nx - 140}" y="${ny - 50}" width="280" height="100" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>`;
    svg += `<rect x="${nx - 140}" y="${ny - 50}" width="6" height="100" rx="3" fill="#10b981"/>`;
    svg += `<rect x="${nx - 137}" y="${ny - 50}" width="3" height="100" fill="#10b981"/>`;
    
    const lines = wordWrap(topic.title.replace(/^\d+(?:\.\d+)*\.?\s*/, ""), 28).slice(0, 3);
    lines.forEach((line, li) => {
      const yOff = (li - (lines.length - 1)/2) * 20;
      svg += `<text x="${nx}" y="${ny + yOff - 5}" font-size="16" font-weight="bold" fill="${textDark}" text-anchor="middle">${escapeXml(line)}</text>`;
    });
    
    svg += `<rect x="${nx - 40}" y="${ny + 25}" width="80" height="20" rx="10" fill="#d1fae5"/>`;
    svg += `<text x="${nx}" y="${ny + 39}" font-size="12" font-weight="bold" fill="#047857" text-anchor="middle">n = ${topic.count} studies</text>`;
  });
  
  svg += `</svg>`;
  return svg;
};
