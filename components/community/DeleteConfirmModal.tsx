
import React from 'react';

interface DeleteConfirmModalProps {
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-theme-shadow/80 backdrop-blur-sm" onClick={onCancel}></div>
            <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl animate-slide-up border border-theme-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-6 mx-auto">
                    <span className="material-symbols-outlined text-3xl">delete_forever</span>
                </div>
                <h3 className="text-2xl font-display font-black italic text-theme-primary text-center mb-3">Discard Specimen?</h3>
                <p className="text-sm text-theme-primary/60 text-center leading-relaxed mb-8">
                    This observation will be permanently removed from the Living Field Guide and your personal archive.
                </p>
                <div className="flex flex-col gap-3">
                    <button
                        onClick={onConfirm}
                        className="w-full py-4 bg-red-600 text-white font-black text-[10px] uppercase tracking-widest rounded-full shadow-lg shadow-red-500/20 active:scale-95 transition-all"
                    >
                        Confirm Deletion
                    </button>
                    <button
                        onClick={onCancel}
                        className="w-full py-4 bg-theme-primary/5 text-theme-primary/40 font-black text-[10px] uppercase tracking-widest rounded-full active:scale-95 transition-all"
                    >
                        Keep Observation
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteConfirmModal;
