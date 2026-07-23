import React from 'react';

interface HelpSheetProps {
    onClose: () => void;
    onReplayTour: () => void;
}

// W2: extracted from LiveLens.tsx — the static "What can I ask or do?"
// cheat sheet (I3). Fully self-contained: no camera/audio/session state,
// just two callbacks back to the parent.
const HelpSheet: React.FC<HelpSheetProps> = ({ onClose, onReplayTour }) => {
    return (
        <div className="absolute inset-0 z-[220] flex items-end sm:items-center justify-center p-4 animate-fade-in pointer-events-auto">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto">
                <div className="p-7">
                    <h3 className="text-xl font-display font-black italic text-stone-900 mb-1">What Can I Ask or Do?</h3>
                    <p className="text-xs text-stone-500 mb-5 uppercase tracking-widest font-bold">Field Guide Cheat Sheet</p>

                    <div className="space-y-4 text-sm text-stone-700">
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">zoom_in</span>
                            <p><b>"Zoom in on that."</b> The agent can adjust zoom, exposure, and switch between front/back cameras for you — just ask.</p>
                        </div>
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">flashlight_on</span>
                            <p><b>"Turn on the torch."</b> Works for low light, if your device supports it.</p>
                        </div>
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">camera</span>
                            <p><b>Tap the shutter</b> for a photo. <b>Hold it</b> to record up to 30s of video.</p>
                        </div>
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">mic</span>
                            <p><b>Hold the mic</b> for an audio-only recording. Tap it to mute/unmute your voice to the agent.</p>
                        </div>
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">upload_file</span>
                            <p><b>Already have media?</b> Use the upload button — no camera needed.</p>
                        </div>
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-theme-accent shrink-0">shield</span>
                            <p>The agent won't offer edibility or toxicity guidance for anything it identifies — misidentification is genuinely dangerous, so it always sticks to biology and ID.</p>
                        </div>
                    </div>

                    <button
                        onClick={onReplayTour}
                        className="mt-6 w-full py-3.5 rounded-2xl border-2 border-theme-accent/30 text-theme-accent font-black text-xs uppercase tracking-widest active:scale-95 transition-transform flex items-center justify-center gap-2"
                    >
                        <span className="material-symbols-outlined text-lg">replay</span>
                        Replay Welcome Tour
                    </button>
                    <button
                        onClick={onClose}
                        className="mt-3 w-full py-4 rounded-2xl bg-theme-accent text-white font-black text-xs uppercase tracking-widest active:scale-95 transition-transform"
                    >
                        Got It
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HelpSheet;
