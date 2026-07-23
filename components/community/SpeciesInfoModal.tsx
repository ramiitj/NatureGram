
import React from 'react';

interface SpeciesInfoModalProps {
    species: { name: string; location: string; id: string };
    data: { extract: string; thumbnail: string; loading: boolean } | null;
    onClose: () => void;
}

const SpeciesInfoModal: React.FC<SpeciesInfoModalProps> = ({ species, data, onClose }) => {
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-theme-shadow/80 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative w-full max-w-lg bg-day-bg rounded-3xl overflow-hidden shadow-2xl animate-slide-up border border-theme-primary/10 flex flex-col max-h-[80vh]">
                <div className="p-6 md:p-8 shrink-0 flex items-center justify-between border-b border-theme-primary/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                            <span className="material-symbols-outlined text-2xl">pest_control</span>
                        </div>
                        <div>
                            <h3 className="text-xl font-display font-black italic text-theme-primary tracking-tight">{species.name}</h3>
                            <p className="text-[9px] font-black uppercase tracking-widest text-stone-600 flex items-center gap-1 mt-0.5">
                                <span className="material-symbols-outlined text-[10px]">public</span>
                                {species.location}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close species details" className="text-stone-600 hover:text-theme-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 rounded-full">
                        <span className="material-symbols-outlined text-2xl">close</span>
                    </button>
                </div>

                <div className="p-6 md:p-8 overflow-y-auto hidden-scrollbar flex-1">
                    {data?.loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <span className="material-symbols-outlined text-4xl text-theme-accent animate-spin">sync</span>
                            <p className="text-stone-600 font-black text-[10px] uppercase tracking-widest animate-pulse">Running Global Biological Sweep...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            {data?.thumbnail && (
                                <div className="w-full aspect-[16/9] rounded-2xl overflow-hidden shadow-inner border border-theme-primary/10 shrink-0">
                                    <img src={data.thumbnail} className="w-full h-full object-cover" alt={species.name} />
                                </div>
                            )}
                            <div className="space-y-4">
                                <p className="catalog-label text-[9px] font-black tracking-[0.2em] text-theme-primary uppercase flex items-center gap-1.5 opacity-60">
                                    <span className="material-symbols-outlined text-xs">science</span>
                                    Encyclopedia Data
                                </p>
                                <p className="text-theme-primary font-serif leading-relaxed text-sm text-justify">
                                    {data?.extract}
                                </p>
                            </div>
                            <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4 mt-2 relative overflow-hidden flex items-center gap-4">
                                <span className="material-symbols-outlined text-blue-500 text-3xl opacity-50">map</span>
                                <div>
                                    <p className="text-blue-600 font-bold text-xs">Geo-Spatial Sighting</p>
                                    <p className="text-blue-600/70 text-[10px] leading-relaxed mt-1">This species was encountered within the <strong>{species.location}</strong> ecological zone. Local coordinates match observation bounds.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SpeciesInfoModal;
