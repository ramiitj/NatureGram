import React from 'react';

interface SearchFiltersPanelProps {
    mediaFilter: 'all' | 'image' | 'video' | 'audio';
    setMediaFilter: (value: 'all' | 'image' | 'video' | 'audio') => void;
    dateFilter: 'all' | 'today' | 'week' | 'month';
    setDateFilter: (value: 'all' | 'today' | 'week' | 'month') => void;
    sortOrder: 'newest' | 'likes' | 'title';
    setSortOrder: (value: 'newest' | 'likes' | 'title') => void;
    allAvailableLabels: string[];
    selectedLabels: string[];
    toggleLabelFilter: (label: string) => void;
}

// W2: extracted from Community.tsx's collapsible "advanced filters" drawer
// (format/timeline/sort/taxon) — a self-contained control panel over a
// small, fully-owned set of filter state passed down from the parent.
const SearchFiltersPanel: React.FC<SearchFiltersPanelProps> = ({
    mediaFilter, setMediaFilter,
    dateFilter, setDateFilter,
    sortOrder, setSortOrder,
    allAvailableLabels, selectedLabels, toggleLabelFilter,
}) => {
    return (
        <div className="p-6 bg-white border border-theme-primary/10 rounded-2xl flex flex-col gap-5 animate-slide-up shadow-md">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Format Filter */}
                <div className="space-y-2.5">
                    <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Category Format</label>
                    <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                        {(['all', 'image', 'video', 'audio'] as const).map((media) => (
                            <button
                                key={media}
                                onClick={() => setMediaFilter(media)}
                                className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                    mediaFilter === media
                                        ? 'bg-theme-primary text-white font-black shadow-sm'
                                        : 'text-theme-primary/50 hover:text-theme-primary'
                                }`}
                            >
                                {media === 'all' ? 'All' : media}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Timeline Filter */}
                <div className="space-y-2.5">
                    <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Timeline Range</label>
                    <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                        {(['all', 'today', 'week', 'month'] as const).map((opt) => (
                            <button
                                key={opt}
                                onClick={() => setDateFilter(opt)}
                                className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                    dateFilter === opt
                                        ? 'bg-theme-primary text-white font-black shadow-sm'
                                        : 'text-theme-primary/50 hover:text-theme-primary'
                                }`}
                            >
                                {opt === 'all' ? 'All' : opt === 'today' ? 'Today' : opt === 'week' ? '1Wk' : '1Mo'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Ordering Selection */}
                <div className="space-y-2.5">
                    <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Sort Sequence</label>
                    <div className="grid grid-cols-3 gap-1 bg-stone-100 p-1 rounded-xl">
                        {(['newest', 'likes', 'title'] as const).map((opt) => (
                            <button
                                key={opt}
                                onClick={() => setSortOrder(opt)}
                                className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                    sortOrder === opt
                                        ? 'bg-theme-primary text-white font-black shadow-sm'
                                        : 'text-theme-primary/50 hover:text-theme-primary'
                                }`}
                            >
                                {opt === 'newest' ? 'Newest' : opt === 'likes' ? 'Likes' : 'A-Z'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Species taxonomic selection */}
            {allAvailableLabels.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-theme-primary/5">
                    <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Filter Specific Taxons Native</label>
                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-2 no-scrollbar">
                        {allAvailableLabels.map((lbl) => {
                            const isSelected = selectedLabels.includes(lbl);
                            return (
                                <button
                                    key={lbl}
                                    onClick={() => toggleLabelFilter(lbl)}
                                    className={`px-2.5 py-1 text-[8px] font-black uppercase tracking-widest rounded-full border transition-all ${
                                        isSelected
                                            ? 'bg-theme-accent border-theme-accent text-white font-bold'
                                            : 'bg-white border-theme-primary/10 text-theme-primary/60 hover:bg-stone-50'
                                    }`}
                                >
                                    {lbl}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchFiltersPanel;
