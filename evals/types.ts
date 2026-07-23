export interface EvalFixture {
    id: string;
    description: string;
    mimeType: string;
    getImageBuffer: () => Buffer;
    // Ground truth: is there a plant/animal/fungus/natural subject at all
    // (see the isNatureSubject scope gate in genAiService.ts/constants.ts).
    expectedIsNatureSubject: boolean;
    // Only meaningful when expectedIsNatureSubject is true. A fixture with
    // real species ground truth (user-supplied, see evals/README.md) sets
    // this; the built-in synthetic negative controls never do, since there
    // is no honest way to fabricate species ground truth for a solid-color
    // test image.
    expectedLabelsContainsAny?: string[];
}

export interface FixtureOutcome {
    fixtureId: string;
    description: string;
    skipped: boolean;
    skipReason?: string;
    passed?: boolean;
    actualIsNatureSubject?: boolean;
    actualLabels?: string[];
    actualConfidence?: 'high' | 'medium' | 'low';
    latencyMs?: number;
    error?: string;
}
