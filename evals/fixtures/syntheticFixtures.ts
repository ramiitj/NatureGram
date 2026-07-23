import { encodePng } from "../pngEncoder.ts";
import type { EvalFixture } from "../types.ts";

// Synthetic, deterministically-generated negative-control fixtures — NOT
// real wildlife photography. There is no honest way to fabricate
// expert-labeled species ground truth, so these exist only to exercise the
// scope gate (isNatureSubject, see F2 in genAiService.ts/constants.ts)
// against unambiguous non-nature scenes: a solid color fill and a
// checkerboard are indisputably neither plant, animal, nor fungus. Add real
// labeled photos under evals/fixtures/custom/ (see evals/README.md) to
// exercise taxonomy/confidence scoring against actual species ground truth.
export const getBuiltInFixtures = (): EvalFixture[] => [
    {
        id: 'synthetic-solid-gray',
        description: "Solid gray fill — a blank wall/screen, unambiguously not a nature subject.",
        mimeType: 'image/png',
        getImageBuffer: () => encodePng(64, 64, () => [128, 128, 128]),
        expectedIsNatureSubject: false,
    },
    {
        id: 'synthetic-checkerboard',
        description: "Synthetic checkerboard test pattern — unambiguously not a nature subject.",
        mimeType: 'image/png',
        getImageBuffer: () => encodePng(64, 64, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0) ? [20, 20, 20] : [230, 230, 230]),
        expectedIsNatureSubject: false,
    },
    {
        id: 'synthetic-solid-blue',
        description: "Solid saturated blue fill — no discernible organism, unambiguously not a nature subject.",
        mimeType: 'image/png',
        getImageBuffer: () => encodePng(64, 64, () => [40, 90, 200]),
        expectedIsNatureSubject: false,
    },
];
