/**
 * Darwin Core Archive export of public sightings, for GBIF and other biodiversity portals.
 *
 * An archive is a zip holding:
 *   occurrence.csv  one row per sighting (CSV, UTF-8, header row)
 *   meta.xml        which Darwin Core term each column is
 *   eml.xml         who published the data, its licence and how it was gathered
 *
 * What goes in, and what never does:
 *  - Only public sightings that are not hidden, not waiting for review and not demo posts.
 *  - Only rows with a scientific name (GBIF requires one); the rest are counted as skipped.
 *  - Coordinates only when the explorer chose to show the place, never for sensitive species,
 *    and rounded to 0.1 degree (about 11 km), with coordinateUncertaintyInMeters to match.
 *  - recordedBy is the public username, unless the account is a guest or opted out.
 *  - No captions, comments or notes: only the identification, date, place and photo link.
 */
import zlib from 'zlib';

export const DWC_LICENSE = 'http://creativecommons.org/licenses/by-nc/4.0/legalcode';
const TERMS = [
  ['occurrenceID', 'http://rs.tdwg.org/dwc/terms/occurrenceID'],
  ['basisOfRecord', 'http://rs.tdwg.org/dwc/terms/basisOfRecord'],
  ['eventDate', 'http://rs.tdwg.org/dwc/terms/eventDate'],
  ['scientificName', 'http://rs.tdwg.org/dwc/terms/scientificName'],
  ['vernacularName', 'http://rs.tdwg.org/dwc/terms/vernacularName'],
  ['taxonRank', 'http://rs.tdwg.org/dwc/terms/taxonRank'],
  ['decimalLatitude', 'http://rs.tdwg.org/dwc/terms/decimalLatitude'],
  ['decimalLongitude', 'http://rs.tdwg.org/dwc/terms/decimalLongitude'],
  ['coordinateUncertaintyInMeters', 'http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters'],
  ['geodeticDatum', 'http://rs.tdwg.org/dwc/terms/geodeticDatum'],
  ['countryCode', 'http://rs.tdwg.org/dwc/terms/countryCode'],
  ['locality', 'http://rs.tdwg.org/dwc/terms/locality'],
  ['recordedBy', 'http://rs.tdwg.org/dwc/terms/recordedBy'],
  ['identificationVerificationStatus', 'http://rs.tdwg.org/dwc/terms/identificationVerificationStatus'],
  ['license', 'http://purl.org/dc/terms/license'],
  ['rightsHolder', 'http://purl.org/dc/terms/rightsHolder'],
  ['associatedMedia', 'http://rs.tdwg.org/dwc/terms/associatedMedia'],
  ['informationWithheld', 'http://rs.tdwg.org/dwc/terms/informationWithheld'],
  ['modified', 'http://purl.org/dc/terms/modified'],
];
export const DWC_COLUMNS = TERMS.map(t => t[0]);

const BINOMIAL = /^[A-Z][a-z]+(?: [a-z][a-z-]+){1,2}$/; // genus + species (+ subspecies): a lone capitalised word is too often a common name
const csv = (v) => {
  const s = v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const round1 = (x) => Math.round(x * 10) / 10;
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t?._seconds === 'number' ? t._seconds * 1000 : typeof t === 'number' ? t : 0);

/** Is this sighting eligible for export at all? */
export function exportable(id, p) {
  if (!p || p.isPublic !== true) return false;
  if (p.reportStatus === 'hidden') return false;
  if (['pending', 'held', 'rejected', 'edited'].includes(p.moderation?.status)) return false;
  if (id.startsWith('seed_') || String(p.userId || '').startsWith('system_seeder')) return false;
  return true;
}

/** Scientific and vernacular names from a sighting's labels (and the guide's ID when stored). */
export function namesOf(p) {
  const labels = (Array.isArray(p.labels) ? p.labels : []).map(l => String(l || '').trim()).filter(Boolean);
  const ai = (p.items?.[0]?.aiIdentifications || p.aiIdentifications || [])[0];
  // Labels are [common name, scientific name, ...]: the first label is never taken as the scientific
  // name, since "Barn owl" looks just like a binomial. The guide's own scientific name wins when stored.
  const scientific = [ai?.scientificName, ...labels.slice(1)].map(x => String(x || '').trim()).find(l => BINOMIAL.test(l)) || '';
  const vernacular = labels.find(l => l !== scientific && !/^(unknown|nature|unidentified)/i.test(l)) || '';
  const rank = scientific ? (scientific.split(' ').length >= 2 ? 'species' : 'genus') : '';
  return { scientific, vernacular, rank };
}

/**
 * One occurrence row (object keyed by DWC_COLUMNS) or null if it must be skipped.
 * opts: { publicHost, coords: {lat,lng}|null, profile, verified: boolean|null }
 */
export function occurrenceRow(id, p, { publicHost, coords = null, profile = null, verified = null } = {}) {
  const { scientific, vernacular, rank } = namesOf(p);
  if (!scientific) return null;
  const sensitive = p.aiFlags?.sensitiveSpecies === true;
  const showPlace = p.showLocation === true && !sensitive;
  const withheld = [];
  let lat = '', lng = '', unc = '';
  if (showPlace && coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    lat = round1(coords.lat); lng = round1(coords.lng); unc = 7850; // half-diagonal of a 0.1 degree cell at the equator
    withheld.push('coordinates generalised to 0.1 degree');
  } else if (sensitive) withheld.push('location withheld: sensitive species');
  else withheld.push('location not shared by the observer');
  const nameOk = profile && profile.isAnonymous !== true && profile.profilePrivate !== true && profile.shareNameInExports !== false && profile.username;
  const recordedBy = nameOk ? String(profile.username).slice(0, 60) : '';
  const when = ms(p.observedAt) || ms(p.timestamp); // when the photo was taken, else when it was shared
  const status = verified === true ? 'verified by community' : verified === false ? 'unverified' : (p.communityVerified ? 'verified by community' : 'unverified');
  return {
    occurrenceID: `https://${publicHost}/post/${id}`,
    basisOfRecord: 'HumanObservation',
    eventDate: when ? new Date(when).toISOString().slice(0, 10) : '',
    scientificName: scientific,
    vernacularName: vernacular,
    taxonRank: rank,
    decimalLatitude: lat, decimalLongitude: lng, coordinateUncertaintyInMeters: unc,
    geodeticDatum: lat !== '' ? 'WGS84' : '',
    countryCode: /^[A-Z]{2}$/.test(String(p.countryCode || '')) ? p.countryCode : '',
    locality: showPlace ? String(p.locationArea || '').slice(0, 120) : '',
    recordedBy,
    identificationVerificationStatus: status,
    license: DWC_LICENSE,
    rightsHolder: recordedBy || 'NatureGram explorer',
    associatedMedia: /^https:\/\//.test(String(p.imageUrl || p.thumbnailUrl || '')) ? (p.imageUrl || p.thumbnailUrl) : '',
    informationWithheld: withheld.join('; '),
    modified: new Date().toISOString().slice(0, 10),
  };
}

export const csvHeader = () => DWC_COLUMNS.join(',');
export const csvLine = (row) => DWC_COLUMNS.map(c => csv(row[c])).join(',');

export function metaXml() {
  const fields = TERMS.map(([, term], i) => `      <field index="${i}" term="${term}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="," linesTerminatedBy="\\n" fieldsEnclosedBy="&quot;" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.csv</location></files>
    <id index="0"/>
${fields}
  </core>
</archive>
`;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function emlXml({ publicHost, count, contactEmail = '' }) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="eml://ecoinformatics.org/eml-2.1.1 http://rs.gbif.org/schema/eml-gbif-profile/1.1/eml.xsd"
  packageId="${xmlEsc(publicHost)}/dwca/${today}" system="${xmlEsc(publicHost)}" scope="system" xml:lang="en">
  <dataset>
    <title>NatureGram community observations</title>
    <creator><organizationName>NatureGram</organizationName><onlineUrl>https://${xmlEsc(publicHost)}</onlineUrl>${contactEmail ? `<electronicMailAddress>${xmlEsc(contactEmail)}</electronicMailAddress>` : ''}</creator>
    <metadataProvider><organizationName>NatureGram</organizationName></metadataProvider>
    <pubDate>${today}</pubDate>
    <language>en</language>
    <abstract><para>Observations of wild plants, animals and fungi shared publicly by explorers on NatureGram (${count} records in this export). Identifications are proposed by the explorer, often with help from an AI naturalist, and can be confirmed by other explorers; identificationVerificationStatus says whether at least two explorers agreed. Coordinates are generalised to 0.1 degree and withheld for sensitive species.</para></abstract>
    <intellectualRights><para>This work is licensed under a <ulink url="${DWC_LICENSE}"><citetitle>Creative Commons Attribution Non Commercial (CC-BY-NC) 4.0 License</citetitle></ulink>.</para></intellectualRights>
    <methods><methodStep><description><para>Photographs, video and sound recorded in the field with the NatureGram app. Only public, unhidden observations with a scientific name are included.</para></description></methodStep></methods>
    <contact><organizationName>NatureGram</organizationName>${contactEmail ? `<electronicMailAddress>${xmlEsc(contactEmail)}</electronicMailAddress>` : ''}</contact>
  </dataset>
</eml:eml>
`;
}

// ------------------------------------------------------------------ minimal zip writer (deflate)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Buffer|string }] -> Buffer of a .zip */
export function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
