import { TaxonResolution } from "../types";

// GBIF's species search API is free, requires no API key, and is CORS-open
// (access-control-allow-origin: *, confirmed live) — the same "call a
// public third-party API directly from the browser" pattern this app
// already uses for reverse geocoding (Nominatim, in PostSessionView.tsx).
// /species/search (not /species/match, which only matches scientific
// names) searches vernacular names too, which is what this app's
// AI-proposed labels ("Northern Cardinal") actually are.
const GBIF_SEARCH_URL = 'https://api.gbif.org/v1/species/search';

// Resolves a freeform common name (as proposed by the AI pipeline) against
// GBIF's public taxonomic backbone. Returns null — never throws — on no
// match, an ambiguous result, or a network failure: this is best-effort
// enrichment, and a failed resolution should never be treated as an error
// by callers (see enrichPostTaxonomy in firebaseService.ts).
export const resolveCanonicalTaxon = async (label: string): Promise<TaxonResolution | null> => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === 'Unknown' || trimmed === 'No Nature Subject Detected') return null;

    try {
        const res = await fetch(`${GBIF_SEARCH_URL}?q=${encodeURIComponent(trimmed)}&limit=1`);
        if (!res.ok) return null;
        const data = await res.json();
        const match = data?.results?.[0];
        if (!match || !match.key) return null;

        return {
            matchedLabel: trimmed,
            gbifKey: match.key,
            scientificName: match.scientificName || match.canonicalName || trimmed,
            canonicalName: match.canonicalName || match.scientificName || trimmed,
            rank: match.rank,
            kingdom: match.kingdom,
            phylum: match.phylum,
            class: match.class,
            order: match.order,
            family: match.family,
            genus: match.genus,
            taxonomicStatus: match.taxonomicStatus,
        };
    } catch (e) {
        console.warn(`[TaxonomyService] GBIF resolution failed for "${trimmed}":`, e);
        return null;
    }
};

// Resolves multiple labels in parallel, deduping and silently dropping
// anything that didn't resolve. Used to enrich a whole post's label set at
// once rather than one at a time.
export const resolveCanonicalTaxa = async (labels: string[]): Promise<TaxonResolution[]> => {
    const uniqueLabels = Array.from(new Set(labels.map(l => l.trim()).filter(Boolean)));
    const resolved = await Promise.all(uniqueLabels.map(resolveCanonicalTaxon));
    return resolved.filter((r): r is TaxonResolution => r !== null);
};
