import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { EvalFixture } from "../types.ts";

interface ManifestEntry {
    id: string;
    description: string;
    imageFile: string;
    mimeType?: string;
    expectedIsNatureSubject: boolean;
    expectedLabelsContainsAny?: string[];
}

// Loads user-supplied real fixtures from evals/fixtures/custom/manifest.json
// (see evals/README.md for the format). Returns an empty list — not an
// error — when no manifest exists, since a fresh checkout of this repo has
// no real labeled photos to run against and the harness must still work
// with just the built-in synthetic fixtures.
export const loadCustomFixtures = (customDir: string): EvalFixture[] => {
    const manifestPath = path.join(customDir, 'manifest.json');
    if (!existsSync(manifestPath)) return [];

    const entries: ManifestEntry[] = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return entries.map(entry => ({
        id: entry.id,
        description: entry.description,
        mimeType: entry.mimeType || 'image/jpeg',
        getImageBuffer: () => readFileSync(path.join(customDir, entry.imageFile)),
        expectedIsNatureSubject: entry.expectedIsNatureSubject,
        expectedLabelsContainsAny: entry.expectedLabelsContainsAny,
    }));
};
