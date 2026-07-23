import { TaxonResolution } from "../types";
import { SupportedLanguage } from "../i18n/translations";

// GBIF's species search API is free, requires no API key, and is CORS-open
// (access-control-allow-origin: *, confirmed live) — the same "call a
// public third-party API directly from the browser" pattern this app
// already uses for reverse geocoding (Nominatim, in PostSessionView.tsx).
// /species/search (not /species/match, which only matches scientific
// names) searches vernacular names too, which is what this app's
// AI-proposed labels ("Northern Cardinal") actually are.
const GBIF_SEARCH_URL = 'https://api.gbif.org/v1/species/search';

// V3: /species/search results aren't reliably keyed to the GBIF Backbone
// Taxonomy (confirmed live: searching "Northern Cardinal" returns a
// third-party checklist record with only 4 English vernacular names),
// whereas /species/match resolves a scientific name to the backbone's
// usageKey, whose dedicated vernacularNames endpoint carries the full,
// richly-multilingual list (confirmed live: "Panthera leo" resolves to
// backbone key 5219404, which returns 200+ names across 80+ ISO 639-2
// language codes, including "spa": "León" and "hin"-adjacent scripts).
const GBIF_MATCH_URL = 'https://api.gbif.org/v1/species/match';
const gbifVernacularUrl = (backboneKey: number) => `https://api.gbif.org/v1/species/${backboneKey}/vernacularNames`;

// This app's 2-letter UI language codes (i18n/translations.ts) mapped to
// the ISO 639-2/T codes GBIF's vernacularNames.language actually uses.
const UI_LANGUAGE_TO_GBIF: Record<SupportedLanguage, string> = {
    en: 'eng',
    es: 'spa',
    hi: 'hin',
};

// Best-effort: resolves a scientific name to the GBIF Backbone Taxonomy's
// canonical usageKey, then fetches its full vernacular-name list. Never
// throws and returns [] on any failure — this is enrichment on top of the
// already-resolved canonical taxon, not something callers should block on.
const fetchVernacularNames = async (scientificName: string): Promise<{ language: string; name: string }[]> => {
    try {
        const matchRes = await fetch(`${GBIF_MATCH_URL}?name=${encodeURIComponent(scientificName)}`);
        if (!matchRes.ok) return [];
        const matchData = await matchRes.json();
        const backboneKey = matchData?.usageKey;
        if (!backboneKey) return [];

        const vernacularRes = await fetch(`${gbifVernacularUrl(backboneKey)}?limit=300`);
        if (!vernacularRes.ok) return [];
        const vernacularData = await vernacularRes.json();
        const results = vernacularData?.results;
        if (!Array.isArray(results)) return [];

        return results
            .filter((r: any) => r?.vernacularName && r?.language)
            .map((r: any) => ({ language: r.language as string, name: r.vernacularName as string }));
    } catch (e) {
        console.warn(`[TaxonomyService] GBIF vernacular-name lookup failed for "${scientificName}":`, e);
        return [];
    }
};

// Picks a region-appropriate common name for the given UI language out of
// an already-resolved taxon's vernacular names. Returns null (never the
// English/scientific name as a silent substitute) so callers can fall back
// to whatever they already show — this is additive enrichment, not a
// replacement for the AI-proposed label.
export const getRegionalCommonName = (resolution: TaxonResolution, uiLanguage: SupportedLanguage): string | null => {
    const gbifLanguage = UI_LANGUAGE_TO_GBIF[uiLanguage];
    const match = resolution.vernacularNames?.find(v => v.language === gbifLanguage);
    return match?.name || null;
};

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

        const scientificName = match.scientificName || match.canonicalName || trimmed;
        const vernacularNames = await fetchVernacularNames(scientificName);

        return {
            matchedLabel: trimmed,
            gbifKey: match.key,
            scientificName,
            canonicalName: match.canonicalName || match.scientificName || trimmed,
            rank: match.rank,
            kingdom: match.kingdom,
            phylum: match.phylum,
            class: match.class,
            order: match.order,
            family: match.family,
            genus: match.genus,
            taxonomicStatus: match.taxonomicStatus,
            vernacularNames,
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
