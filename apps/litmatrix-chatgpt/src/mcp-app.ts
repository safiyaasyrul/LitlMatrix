import { App } from "@modelcontextprotocol/ext-apps";
import "./style.css";

type RecordData = Record<string, unknown>;

const status = document.getElementById("status")!;
const counts = document.getElementById("counts")!;
const titleInput = document.getElementById("review-title") as HTMLInputElement;
const fileInput = document.getElementById("record-file") as HTMLInputElement;
const importButton = document.getElementById("import-button") as HTMLButtonElement;
const app = new App({ name: "LitlMatrix", version: "0.4.0" });

let connected = false;

function clean(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function splitDelimitedLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string): RecordData[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitDelimitedLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const find = (...names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
  const titleIndex = find("title", "articletitle", "documenttitle");
  const abstractIndex = find("abstract", "abstracttext");
  const yearIndex = find("year", "publicationyear", "coverdate");
  const doiIndex = find("doi", "digitalobjectidentifier");
  const authorIndex = find("authors", "author", "authornames");
  const sourceIndex = find("source", "journal", "sourcetitle", "publicationname");
  const dbIndex = find("database", "databasesource", "source");
  return lines.slice(1).map((line, row) => {
    const cells = splitDelimitedLine(line);
    const authors = authorIndex >= 0 ? cells[authorIndex].split(/;|\||\s+and\s+/i).map(clean).filter(Boolean) : [];
    return {
      id: `csv_${row + 1}`,
      title: clean(titleIndex >= 0 ? cells[titleIndex] : ""),
      authors,
      year: clean(yearIndex >= 0 ? cells[yearIndex] : ""),
      abstract: clean(abstractIndex >= 0 ? cells[abstractIndex] : ""),
      source: clean(sourceIndex >= 0 ? cells[sourceIndex] : ""),
      doi: clean(doiIndex >= 0 ? cells[doiIndex] : "") || undefined,
      databaseSource: clean(dbIndex >= 0 ? cells[dbIndex] : "") || undefined,
    };
  }).filter((r) => r.title);
}

function parseRis(text: string): RecordData[] {
  const blocks = text.split(/\r?\nER\s*-{0,2}\s*\r?\n/i).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const get = (tag: string) => {
      const match = block.match(new RegExp(`^${tag}  -\\s*(.+)$`, "im"));
      return match?.[1]?.trim() ?? "";
    };
    const authors = [...block.matchAll(/^AU  -\s*(.+)$/gim)].map((m) => m[1].trim()).filter(Boolean);
    return {
      id: `ris_${index + 1}`,
      title: get("TI") || get("T1"),
      authors,
      year: get("PY") || get("Y1"),
      abstract: get("AB"),
      source: get("JO") || get("JF") || get("T2"),
      doi: get("DO"),
      databaseSource: "Scopus/WoS export",
    };
  }).filter((r) => r.title);
}

function parseBibtex(text: string): RecordData[] {
  const entries = [...text.matchAll(/@[^\{]+\{\s*([^,]+),([\s\S]*?)\n\}/g)];
  return entries.map((match, index) => {
    const body = match[2];
    const field = (name: string) => body.match(new RegExp(`${name}\\s*=\\s*[\\{\\\"]([\\s\\S]*?)[\\}\\\"]\\s*,?`, "i"))?.[1]?.replace(/[{}]/g, "").trim() ?? "";
    return {
      id: `bib_${index + 1}`,
      title: field("title"),
      authors: field("author").split(/\s+and\s+/i).map(clean).filter(Boolean),
      year: field("year"),
      abstract: field("abstract"),
      source: field("journal") || field("booktitle"),
      doi: field("doi") || undefined,
      databaseSource: "Scopus/WoS export",
    };
  }).filter((r) => r.title);
}

function parseRecords(filename: string, text: string): RecordData[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ris")) return parseRis(text);
  if (lower.endsWith(".bib") || lower.endsWith(".bibtex")) return parseBibtex(text);
  return parseCsv(text);
}

function extractStructured(result: any): Record<string, any> {
  return (result?.structuredContent ?? {}) as Record<string, any>;
}

app.ontoolresult = (result) => {
  const structured = extractStructured(result);
  if (structured.recordCount !== undefined) {
    counts.textContent = `Records: ${structured.recordCount} · Decisions: ${structured.decisionCount ?? 0}`;
  }
};

async function importReview() {
  const file = fileInput.files?.[0];
  if (!file) { status.textContent = "Choose a Scopus/WoS CSV, RIS, or BibTeX export first."; return; }
  importButton.disabled = true;
  status.textContent = "Reading researcher-supplied records…";
  try {
    const text = await file.text();
    const records = parseRecords(file.name, text).slice(0, 200);
    if (!records.length) throw new Error("No usable records were detected in the selected file.");
    if (records.length < parseRecords(file.name, text).length) {
      status.textContent = "The file contains more than 200 records; LitlMatrix will use the first 200 supplied records for this review.";
    }
    const started = await app.callServerTool({ name: "litmatrix_start_review", arguments: { title: titleInput.value.trim() || undefined } });
    const reviewId = extractStructured(started).reviewId;
    if (!reviewId) throw new Error("The LitlMatrix server did not return a review ID.");
    const imported = await app.callServerTool({ name: "litmatrix_import_records", arguments: { reviewId, records } });
    const importedData = extractStructured(imported);
    await app.callServerTool({ name: "litmatrix_select_evidence", arguments: { reviewId } });
    const statusResult = await app.callServerTool({ name: "litmatrix_status", arguments: { reviewId } });
    const s = extractStructured(statusResult);
    counts.textContent = `Records: ${importedData.recordCount ?? records.length} · Unresolved screening: ${s.unresolvedCount ?? "—"} · Introduction evidence: ${s.introductionRecordCount ?? "—"} · Detailed evidence: ${s.detailedRecordCount ?? "—"}`;
    status.textContent = `Review ${reviewId} is ready. ChatGPT can now screen records in batches and use the bounded evidence set for synthesis.`;
  } catch (error) {
    status.textContent = `Import error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    importButton.disabled = !connected;
  }
}

fileInput.addEventListener("change", () => { importButton.disabled = !connected || !fileInput.files?.length; });
importButton.addEventListener("click", () => { void importReview(); });

app.connect().then(() => {
  connected = true;
  status.textContent = "LitlMatrix is connected to ChatGPT. No user AI API key is required.";
  importButton.disabled = !fileInput.files?.length;
}).catch((error) => {
  status.textContent = `Connection error: ${String(error)}`;
});
