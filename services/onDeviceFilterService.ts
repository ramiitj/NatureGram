// U1: on-device pre-filter. Runs a general-purpose ImageNet classifier
// (MobileNet) fully client-side, entirely before any Gemini call, purely to
// cut cost/latency and enable degraded offline use — the same idea Merlin/
// Seek use for their own on-device pre-filters. This is NOT a replacement
// for Gemini's actual identification (a 1000-class ImageNet classifier is
// nowhere near good enough for species ID, and isn't being asked to be):
// it only ever gets to make ONE decision — "am I confident enough that
// this is clearly NOT a nature subject (a screen, a wall, an indoor
// object) that skipping the Gemini call entirely is safe" — and defaults
// to "no, call Gemini as normal" whenever it isn't sure, whenever it
// fails/times out, or whenever it detects anything plausibly biological.
// A false negative here (missing an obvious non-nature scene) just costs
// one avoidable Gemini call, same as today; a false positive (skipping a
// real capture) would be a correctness regression, which is why the
// threshold below is deliberately conservative.
import type { MobileNet } from '@tensorflow-models/mobilenet';

export interface OnDevicePrefilterResult {
    ranModel: boolean;
    // False only when the model is confident this is NOT a nature subject.
    // True in every other case, including when the model didn't run.
    isLikelyNatureSubject: boolean;
    topPrediction?: { className: string; probability: number };
}

// Loading TF.js + MobileNet's weights (~16MB) takes real time on first use.
// A capture flow that suddenly got SLOWER because of a "cost-saving"
// feature would be a regression, not an improvement — so this is capped:
// if the model isn't already warm within this budget, the pre-filter is
// skipped entirely for this capture and Gemini is called as it always was.
const MODEL_READY_TIMEOUT_MS = 700;
// Below this confidence, the model isn't sure enough to justify skipping
// a real Gemini call — proceed normally.
const CONFIDENCE_THRESHOLD = 0.6;

// Substrings of MobileNet's ImageNet class names that plausibly indicate a
// clearly non-biological scene (electronics, indoor furniture/structure,
// documents, vehicles). Intentionally short and conservative: this list
// only needs to catch the obvious cases ("pointed the camera at a laptop
// by mistake") — it is never used to accept or reject an actual species
// identification, only to decide whether Gemini gets called at all.
const NON_NATURE_HINTS = [
    'monitor', 'screen', 'laptop', 'notebook', 'desktop_computer', 'keyboard',
    'computer_keyboard', 'cellular_telephone', 'remote_control', 'television',
    'desk', 'file', 'binder', 'envelope', 'wall_clock', 'electric_fan',
    'microwave', 'refrigerator', 'washer', 'toaster', 'espresso_maker',
    'iPod', 'modem', 'printer', 'projector', 'scale', 'vacuum',
];

let modelPromise: Promise<MobileNet> | null = null;

// Kicks off (and memoizes) the model load — call this early (e.g. when a
// camera view mounts) so it has a chance to be warm by the time an actual
// capture happens, rather than paying the load cost inline with the
// user's first shutter press.
export const preloadOnDeviceModel = (): Promise<MobileNet> => {
    if (!modelPromise) {
        modelPromise = (async () => {
            await import('@tensorflow/tfjs');
            const mobilenetModule = await import('@tensorflow-models/mobilenet');
            return mobilenetModule.load({ version: 2, alpha: 1.0 });
        })();
        modelPromise.catch(e => console.warn('[OnDeviceFilter] MobileNet failed to load:', e));
    }
    return modelPromise;
};

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
};

// Runs the pre-filter against an already-decoded image source. Never
// throws — any failure (model not ready in time, classify() erroring,
// an unsupported image source) degrades to "proceed to Gemini normally,"
// exactly like a low/no-signal field environment should.
export const runOnDevicePrefilter = async (
    source: HTMLImageElement | HTMLCanvasElement
): Promise<OnDevicePrefilterResult> => {
    try {
        const model = await withTimeout(preloadOnDeviceModel(), MODEL_READY_TIMEOUT_MS);
        const predictions = await model.classify(source, 3);
        const top = predictions[0];
        if (!top) return { ranModel: true, isLikelyNatureSubject: true };

        const isConfidentNonNature = top.probability >= CONFIDENCE_THRESHOLD
            && NON_NATURE_HINTS.some(hint => top.className.toLowerCase().includes(hint));

        return {
            ranModel: true,
            isLikelyNatureSubject: !isConfidentNonNature,
            topPrediction: { className: top.className, probability: top.probability },
        };
    } catch (e) {
        return { ranModel: false, isLikelyNatureSubject: true };
    }
};

// Convenience wrapper for the common case (a captured/uploaded Blob)
// rather than an already-decoded image element.
export const runOnDevicePrefilterOnBlob = async (blob: Blob): Promise<OnDevicePrefilterResult> => {
    if (typeof createImageBitmap !== 'function') return { ranModel: false, isLikelyNatureSubject: true };
    try {
        const bitmap = await createImageBitmap(blob);
        // MobileNet's classify() doesn't accept ImageBitmap directly —
        // draw it onto an offscreen canvas, which it does accept.
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { bitmap.close(); return { ranModel: false, isLikelyNatureSubject: true }; }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return await runOnDevicePrefilter(canvas);
    } catch (e) {
        return { ranModel: false, isLikelyNatureSubject: true };
    }
};
