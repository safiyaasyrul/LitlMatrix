import { SLRRecord, StudyCharacteristic } from "../types/slr";

export const getIncludedEvidenceKey = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[]
) => {
  const includedIds = new Set(records.map((record) => record.id));
  const evidence = {
    records: [...records]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, title, abstract, authors, year }) => ({
        id,
        title,
        abstract,
        authors,
        year,
      })),
    characteristics: characteristics
      .filter((item) => includedIds.has(item.recordId))
      .sort((a, b) => a.recordId.localeCompare(b.recordId)),
  };
  const serialized = JSON.stringify(evidence);
  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${records.length}:${(hash >>> 0).toString(36)}`;
};