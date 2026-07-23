import React from 'react';

interface DisputeIdentificationModalProps {
    disputeSuggestedLabel: string;
    setDisputeSuggestedLabel: (value: string) => void;
    disputeReason: string;
    setDisputeReason: (value: string) => void;
    isSubmittingVerification: boolean;
    onCancel: () => void;
    onSubmit: () => void;
}

// W2: extracted from Community.tsx's "Suggest Correction" (Q3 dispute)
// form — a small, self-contained modal over its own text-input state.
const DisputeIdentificationModal: React.FC<DisputeIdentificationModalProps> = ({
    disputeSuggestedLabel, setDisputeSuggestedLabel,
    disputeReason, setDisputeReason,
    isSubmittingVerification, onCancel, onSubmit,
}) => {
    return (
        <div className="fixed inset-0 z-[260] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-md" onClick={onCancel}></div>
            <div className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-slide-up p-8">
                <h2 className="text-2xl font-display font-black italic text-stone-900 mb-1">Suggest Correction</h2>
                <p className="text-xs text-stone-500 uppercase tracking-widest font-bold mb-6">What do you think this actually is?</p>

                <label className="block mb-4">
                    <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Your Identification</span>
                    <input
                        type="text"
                        value={disputeSuggestedLabel}
                        onChange={(e) => setDisputeSuggestedLabel(e.target.value)}
                        className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all"
                        placeholder="e.g. Cooper's Hawk"
                    />
                </label>

                <label className="block mb-6">
                    <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Why? (optional)</span>
                    <textarea
                        value={disputeReason}
                        onChange={(e) => setDisputeReason(e.target.value)}
                        rows={3}
                        className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all resize-none"
                        placeholder="e.g. Barred tail and yellow eyes point to Cooper's, not Sharp-shinned"
                    />
                </label>

                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={isSubmittingVerification}
                        className="flex-1 py-4 rounded-2xl border-2 border-stone-100 text-stone-500 font-black text-xs uppercase tracking-widest hover:bg-stone-50 transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSubmit}
                        disabled={isSubmittingVerification || !disputeSuggestedLabel.trim()}
                        className="flex-1 py-4 rounded-2xl bg-theme-accent text-white font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
                    >
                        {isSubmittingVerification ? 'Submitting...' : 'Submit'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DisputeIdentificationModal;
