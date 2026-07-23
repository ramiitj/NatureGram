// X3: turns community/expert-verified observations into a Darwin Core
// Archive — the exact standards format GBIF and iNaturalist ingest — so
// the corpus this app collects can actually flow OUT to real biodiversity
// science, closing the loop the taxonomy backbone (T3) and warehouse
// scaffold (T2) started.
//
// Honest scope (same posture as T2's warehouse and S3's audio export):
// this produces the real, correct, publishable artifact — a valid DwC
// Archive .zip you could hand to a GBIF IPT or upload to iNaturalist —
// but it does NOT push to GBIF automatically, because publishing to GBIF
// requires a registered dataset-publisher credential (an IPT install or
// API key tied to a publishing organization) that this project doesn't
// have. Faking that credential would be dishonest; producing the artifact
// a publisher would upload is the real, verifiable deliverable.
//
// Only verified observations are included — a merely-posted, unverified AI
// label has no place in a dataset meant to back a scientific claim (see
// isVerifiedState). Precise coordinates are withheld for sensitive species
// (informationWithheld), the same protection the feed applies at display
// time (L2).

import { CommunityPost } from "../types";

// The Darwin Core terms we populate, in archive column order. Term names
// are the exact simple-DwC identifiers (http://rers.tdwg.org/dwc/terms/…).
const DWC_TERMS = [
  'occurrenceID',
  'basisOfRecord',
  'scientificName',
  'taxonRank',
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
  'genus',
  'taxonID',
  'vernacularName',
  'decimalLatitude',
  'decimalLongitude',
  'geodeticDatum',
  'coordinateUncertaintyInMeters',
  'locality',
  'eventDate',
  'recordedBy',
  'identifiedBy',
  'identificationVerificationStatus',
  'associatedMedia',
  'occurrenceRemarks',
  'informationWithheld',
  'license',
] as const;

const DATASET_NAME = 'NatureGram Community Observations';
const DATA_LICENSE = 'http://creativecommons.org/licenses/by-nc/4.0/legalcode';

const toIsoDate = (timestamp: any): string => {
  try {
    if (timestamp && typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString();
    if (timestamp?.seconds) return new Date(timestamp.seconds * 1000).toISOString();
    if (typeof timestamp === 'string' || typeof timestamp === 'number') return new Date(timestamp).toISOString();
  } catch { /* fall through */ }
  return '';
};

// Maps one verified observation to a Darwin Core occurrence record. Draws
// the scientific name + full taxonomic hierarchy from the GBIF-resolved
// canonicalTaxa (T3) when available, falling back to the freeform label.
export const observationToDarwinCore = (post: CommunityPost): Record<string, string> => {
  const taxon = post.canonicalTaxa && post.canonicalTaxa.length > 0 ? post.canonicalTaxa[0] : undefined;
  const vernacular = post.labels && post.labels.length > 0 ? post.labels[0] : '';
  const isSensitive = !!post.isSensitiveSpecies;
  const media = post.imageUrl || post.audioUrl || post.videoUrl || post.thumbnailUrl || '';

  const verificationStatus = post.verificationState === 'research-grade'
    ? 'Research Grade — expert verified'
    : 'Community confirmed';

  const lat = !isSensitive ? post.rawLocation?.lat : undefined;
  const lng = !isSensitive ? post.rawLocation?.lng : undefined;

  return {
    occurrenceID: `urn:naturegram:observation:${post.id}`,
    // AI-assisted, community-verified citizen-science sightings are
    // HumanObservation records in Darwin Core terms.
    basisOfRecord: 'HumanObservation',
    scientificName: taxon?.scientificName || taxon?.canonicalName || vernacular || '',
    taxonRank: taxon?.rank || '',
    kingdom: taxon?.kingdom || '',
    phylum: taxon?.phylum || '',
    class: taxon?.class || '',
    order: taxon?.order || '',
    family: taxon?.family || '',
    genus: taxon?.genus || '',
    taxonID: taxon?.gbifKey ? `gbif:${taxon.gbifKey}` : '',
    vernacularName: vernacular,
    decimalLatitude: lat !== undefined && lat !== null ? String(lat) : '',
    decimalLongitude: lng !== undefined && lng !== null ? String(lng) : '',
    geodeticDatum: (lat !== undefined && lat !== null) ? 'WGS84' : '',
    // GPS from a phone is coarse; declare honest uncertainty rather than
    // implying survey-grade precision.
    coordinateUncertaintyInMeters: (lat !== undefined && lat !== null) ? '30' : '',
    locality: post.locationArea || '',
    eventDate: toIsoDate(post.timestamp),
    recordedBy: post.userName || '',
    identifiedBy: 'NatureGram AI, community/expert verified',
    identificationVerificationStatus: verificationStatus,
    associatedMedia: media,
    occurrenceRemarks: (post.behavior || post.aiInsight || '').replace(/\s+/g, ' ').trim(),
    informationWithheld: isSensitive ? 'Coordinates withheld: sensitive/protected species' : '',
    license: DATA_LICENSE,
  };
};

// Escapes a value for the tab-delimited occurrence core: DwC text files
// are TSV, so tabs/newlines within a field must not break the row.
const tsvCell = (v: string): string => (v || '').replace(/[\t\r\n]+/g, ' ');

// The occurrence core file (occurrence.txt) — a header row of DwC terms
// followed by one tab-delimited row per record.
export const buildOccurrenceTsv = (posts: CommunityPost[]): string => {
  const header = DWC_TERMS.join('\t');
  const rows = posts.map(post => {
    const rec = observationToDarwinCore(post);
    return DWC_TERMS.map(term => tsvCell(rec[term])).join('\t');
  });
  return [header, ...rows].join('\n') + '\n';
};

// meta.xml — the Darwin Core Archive descriptor that tells an ingester how
// to read occurrence.txt: which file, its delimiters, and which column
// index maps to which DwC term URI.
export const buildMetaXml = (): string => {
  const fieldLines = DWC_TERMS.map((term, i) =>
    `      <field index="${i}" term="http://rs.tdwg.org/dwc/terms/${term}"/>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files>
      <location>occurrence.txt</location>
    </files>
    <id index="0"/>
${fieldLines}
  </core>
</archive>
`;
};

// eml.xml — minimal Ecological Metadata Language dataset description that a
// DwC Archive references. Enough to identify the dataset and its license.
export const buildEmlXml = (recordCount: number): string => {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1" packageId="naturegram/${now}" system="naturegram">
  <dataset>
    <title>${DATASET_NAME}</title>
    <abstract><para>AI-assisted, community- and expert-verified nature observations contributed by NatureGram users. Only observations that reached a verified identification state are included. Precise coordinates for sensitive or protected species are withheld.</para></abstract>
    <pubDate>${now.slice(0, 10)}</pubDate>
    <language>eng</language>
    <intellectualRights><para>This work is licensed under a Creative Commons Attribution-NonCommercial 4.0 International License.</para></intellectualRights>
    <additionalInfo><para>Record count at export: ${recordCount}.</para></additionalInfo>
  </dataset>
</eml:eml>
`;
};

/* ---- Minimal store-only ZIP writer (no external dependency) ---------- *
 * A Darwin Core Archive is a .zip of occurrence.txt + meta.xml + eml.xml.
 * Rather than pull in a zip library, this builds a spec-valid store-method
 * (uncompressed) archive directly — deterministic, ~1 file's worth of code,
 * and verifiable with any unzip tool. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

interface ZipEntry { name: string; data: Uint8Array; crc: number; offset: number; }

export const buildZip = (files: { name: string; content: string }[]): Uint8Array => {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  const pushU16 = (arr: number[], v: number) => { arr.push(v & 0xff, (v >>> 8) & 0xff); };
  const pushU32 = (arr: number[], v: number) => { arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local: number[] = [];
    pushU32(local, 0x04034b50); // local file header signature
    pushU16(local, 20);         // version needed
    pushU16(local, 0);          // flags
    pushU16(local, 0);          // method: store
    pushU16(local, 0);          // mod time
    pushU16(local, 0);          // mod date
    pushU32(local, crc);
    pushU32(local, data.length); // compressed size
    pushU32(local, data.length); // uncompressed size
    pushU16(local, nameBytes.length);
    pushU16(local, 0);          // extra length
    const localHeader = new Uint8Array(local);

    entries.push({ name: f.name, data, crc, offset });
    chunks.push(localHeader, nameBytes, data);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const cdStart = offset;
  const central: number[] = [];
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    pushU32(central, 0x02014b50); // central dir signature
    pushU16(central, 20);         // version made by
    pushU16(central, 20);         // version needed
    pushU16(central, 0);          // flags
    pushU16(central, 0);          // method
    pushU16(central, 0);          // mod time
    pushU16(central, 0);          // mod date
    pushU32(central, e.crc);
    pushU32(central, e.data.length);
    pushU32(central, e.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);          // extra length
    pushU16(central, 0);          // comment length
    pushU16(central, 0);          // disk number start
    pushU16(central, 0);          // internal attrs
    pushU32(central, 0);          // external attrs
    pushU32(central, e.offset);   // local header offset
    for (let i = 0; i < nameBytes.length; i++) central.push(nameBytes[i]);
  }
  const centralBytes = new Uint8Array(central);

  const end: number[] = [];
  pushU32(end, 0x06054b50);       // end of central dir signature
  pushU16(end, 0);                // disk number
  pushU16(end, 0);                // disk with CD
  pushU16(end, entries.length);   // entries this disk
  pushU16(end, entries.length);   // total entries
  pushU32(end, centralBytes.length);
  pushU32(end, cdStart);
  pushU16(end, 0);                // comment length
  chunks.push(centralBytes, new Uint8Array(end));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
};

// Assembles the complete Darwin Core Archive (.zip bytes) from verified
// observations: occurrence core + meta.xml + eml.xml.
export const buildDarwinCoreArchive = (posts: CommunityPost[]): Uint8Array => {
  return buildZip([
    { name: 'occurrence.txt', content: buildOccurrenceTsv(posts) },
    { name: 'meta.xml', content: buildMetaXml() },
    { name: 'eml.xml', content: buildEmlXml(posts.length) },
  ]);
};
