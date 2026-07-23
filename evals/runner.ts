import { GoogleGenAI, Type } from "@google/genai";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBuiltInFixtures } from "./fixtures/syntheticFixtures.ts";
import { loadCustomFixtures } from "./fixtures/customFixtures.ts";
import { isNatureSubjectCorrect, anyLabelMatches, confidenceBucketAccuracy } from "./scoring.ts";
import type { EvalFixture, FixtureOutcome } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL = 'gemini-2.5-flash';

// Deliberately NOT imported from services/genAiService.ts: that module is
// written for the browser (FileReader, window.location, the Firebase
// client SDK's auth state) and calls Gemini through this app's own
// /api-proxy server route. This script calls the Gemini API directly with
// a real key (GEMINI_API_KEY) instead, which only makes sense run
// server-side/in CI — duplicating this one schema/prompt is a smaller cost
// than making the app's runtime code isomorphic just for this script.
const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        isNatureSubject: { type: Type.BOOLEAN, description: "False if the media contains no plant, animal, fungus, or other natural subject." },
        taxonomy: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Identified species using standard common names in Title Case. Empty if isNatureSubject is false." },
        confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    },
    required: ['isNatureSubject', 'taxonomy'],
};

const PROMPT = `Analyze this image. Identify all species present, using standard common names in Title Case, or an empty taxonomy array if there is no plant, animal, fungus, or other natural subject in frame. Also state your confidence ('high', 'medium', or 'low') in the identification.`;

const runFixture = async (ai: GoogleGenAI, fixture: EvalFixture): Promise<FixtureOutcome> => {
    const startedAt = Date.now();
    try {
        const imageBuffer = fixture.getImageBuffer();
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: {
                parts: [
                    { inlineData: { data: imageBuffer.toString('base64'), mimeType: fixture.mimeType } },
                    { text: PROMPT },
                ],
            },
            config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
        });
        const result = JSON.parse(response.text || "{}");
        const latencyMs = Date.now() - startedAt;

        const scopeCorrect = isNatureSubjectCorrect(fixture.expectedIsNatureSubject, result.isNatureSubject);
        const labelCorrect = fixture.expectedLabelsContainsAny
            ? anyLabelMatches(fixture.expectedLabelsContainsAny, result.taxonomy || [])
            : null;
        const passed = scopeCorrect && (labelCorrect === null || labelCorrect);

        return {
            fixtureId: fixture.id,
            description: fixture.description,
            skipped: false,
            passed,
            actualIsNatureSubject: result.isNatureSubject,
            actualLabels: result.taxonomy,
            actualConfidence: result.confidence,
            latencyMs,
        };
    } catch (e: any) {
        return { fixtureId: fixture.id, description: fixture.description, skipped: false, passed: false, error: e?.message || String(e) };
    }
};

const writeReport = (outcomes: FixtureOutcome[]) => {
    const resultsDir = path.join(__dirname, 'results');
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
    writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(outcomes, null, 2));

    const ran = outcomes.filter(o => !o.skipped);
    const buckets = confidenceBucketAccuracy(ran.map(o => ({ confidence: o.actualConfidence, correct: !!o.passed })));

    const lines = [
        '# NatureGram Eval Report',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        `- Total fixtures: ${outcomes.length}`,
        `- Ran: ${ran.length}`,
        `- Skipped: ${outcomes.length - ran.length}`,
        `- Passed: ${ran.filter(o => o.passed).length}/${ran.length}`,
        '',
        '## By confidence bucket',
        '',
        ...(['high', 'medium', 'low'] as const).map(b =>
            `- ${b}: ${buckets[b].total > 0 ? `${buckets[b].correct}/${buckets[b].total} correct` : 'no samples'}`
        ),
        '',
        '## Fixtures',
        '',
        ...outcomes.map(o => o.skipped
            ? `- ⏭️ **${o.fixtureId}** — skipped (${o.skipReason})`
            : `- ${o.passed ? '✅' : '❌'} **${o.fixtureId}** — ${o.description}${o.error ? ` — ERROR: ${o.error}` : ` (actual nature=${o.actualIsNatureSubject}, confidence=${o.actualConfidence || 'n/a'}, ${o.latencyMs}ms)`}`
        ),
    ];
    writeFileSync(path.join(resultsDir, 'latest.md'), lines.join('\n') + '\n');
};

const main = async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    const fixtures: EvalFixture[] = [
        ...getBuiltInFixtures(),
        ...loadCustomFixtures(path.join(__dirname, 'fixtures', 'custom')),
    ];

    if (!apiKey) {
        console.warn('[eval] GEMINI_API_KEY not set — skipping all fixtures. Set it to actually run the harness; see evals/README.md.');
        writeReport(fixtures.map(f => ({ fixtureId: f.id, description: f.description, skipped: true, skipReason: 'GEMINI_API_KEY not set' })));
        process.exit(0);
    }

    const ai = new GoogleGenAI({ apiKey });
    const outcomes: FixtureOutcome[] = [];
    for (const fixture of fixtures) {
        outcomes.push(await runFixture(ai, fixture));
    }
    writeReport(outcomes);

    const ran = outcomes.filter(o => !o.skipped);
    const failed = ran.filter(o => !o.passed);
    if (failed.length > 0) {
        console.error(`[eval] ${failed.length}/${ran.length} fixture(s) failed. See evals/results/latest.md`);
        process.exit(1);
    }
    console.log(`[eval] All ${ran.length} fixture(s) passed (${outcomes.length - ran.length} skipped). See evals/results/latest.md`);
};

main();
