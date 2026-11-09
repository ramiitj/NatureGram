import React, { useState } from 'react';
import { Sparkles, Check, X, Compass, Feather, Camera, Trees, FileText, Layers } from 'lucide-react';
import { NaturalistPersona } from '../types';
import { FirebaseService } from '../services/firebaseService';

interface NaturalistPersonaModalProps {
  userId?: string;
  initialPersona?: NaturalistPersona | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (persona: NaturalistPersona) => void;
  showSkipOption?: boolean;
}

const TAXA_OPTIONS = [
  "Birds & Avian Vocalizations",
  "Flora & Fungi",
  "Mammal Ethology",
  "Insects & Pollinators",
  "Marine & Aquatic Life",
  "Amphibians & Reptiles"
];

const STYLE_OPTIONS = [
  "Bioacoustic Soundscapes",
  "Macro Photography",
  "Behavioral Motion Video",
  "Field Journal Notes"
];

const HABITAT_OPTIONS = [
  "Dense Canopy Forests",
  "Coastal Tidepools & Reefs",
  "Alpine & High Elevation",
  "Wetlands & Swamps",
  "Urban Wildlife Habitats"
];

const ARCHETYPE_PRESETS = [
  {
    title: "Avian Bioacoustics Specialist",
    taxa: ["Birds & Avian Vocalizations"],
    styles: ["Bioacoustic Soundscapes", "Field Journal Notes"],
    habitats: ["Dense Canopy Forests", "Wetlands & Swamps"]
  },
  {
    title: "Botanical & Mycological Archivist",
    taxa: ["Flora & Fungi"],
    styles: ["Macro Photography", "Field Journal Notes"],
    habitats: ["Dense Canopy Forests", "Alpine & High Elevation"]
  },
  {
    title: "Coastal & Marine Ethologist",
    taxa: ["Marine & Aquatic Life"],
    styles: ["Behavioral Motion Video", "Macro Photography"],
    habitats: ["Coastal Tidepools & Reefs"]
  },
  {
    title: "Mammalian Ethologist",
    taxa: ["Mammal Ethology"],
    styles: ["Behavioral Motion Video", "Field Journal Notes"],
    habitats: ["Dense Canopy Forests", "Alpine & High Elevation"]
  },
  {
    title: "General Natural History Explorer",
    taxa: ["Birds & Avian Vocalizations", "Flora & Fungi", "Mammal Ethology"],
    styles: ["Bioacoustic Soundscapes", "Macro Photography", "Field Journal Notes"],
    habitats: ["Dense Canopy Forests", "Coastal Tidepools & Reefs", "Wetlands & Swamps"]
  }
];

export const NaturalistPersonaModal: React.FC<NaturalistPersonaModalProps> = ({
  userId,
  initialPersona,
  isOpen,
  onClose,
  onSave,
  showSkipOption = false
}) => {
  const [archetype, setArchetype] = useState<string>(initialPersona?.archetype || "General Natural History Explorer");
  const [selectedTaxa, setSelectedTaxa] = useState<string[]>(initialPersona?.taxaInterests || ["Birds & Avian Vocalizations"]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>(initialPersona?.observationStyles || ["Bioacoustic Soundscapes", "Field Journal Notes"]);
  const [selectedHabitats, setSelectedHabitats] = useState<string[]>(initialPersona?.habitatAffinities || ["Dense Canopy Forests"]);
  const [customFocus, setCustomFocus] = useState<string>(initialPersona?.customFocus || "");
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const toggleItem = (list: string[], setList: (val: string[]) => void, item: string) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const applyPreset = (preset: typeof ARCHETYPE_PRESETS[0]) => {
    setArchetype(preset.title);
    setSelectedTaxa(preset.taxa);
    setSelectedStyles(preset.styles);
    setSelectedHabitats(preset.habitats);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const updatedPersona: NaturalistPersona = {
      archetype,
      taxaInterests: selectedTaxa,
      observationStyles: selectedStyles,
      habitatAffinities: selectedHabitats,
      customFocus: customFocus.trim()
    };

    if (userId && userId !== 'explorer_guest') {
      await FirebaseService.updateNaturalistPersona(userId, updatedPersona);
    }
    setIsSaving(false);
    onSave(updatedPersona);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-5 font-body">
      <div className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded-2xl sm:rounded-3xl max-w-2xl w-full p-5 sm:p-7 shadow-2xl my-auto relative flex flex-col max-h-[88vh] border border-theme-primary/10 dark:border-stone-800">
        
        {/* Sticky Header */}
        <div className="sticky top-0 bg-white dark:bg-stone-900 z-10 pb-4 border-b border-theme-primary/10 dark:border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-theme-accent/10 text-theme-accent flex items-center justify-center shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[9px] text-theme-accent font-bold uppercase tracking-widest block">
                Personalized Discovery
              </span>
              <h2 className="text-lg sm:text-xl font-display font-semibold text-stone-900 dark:text-stone-100">
                Naturalist Persona Profile
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 flex items-center justify-center text-stone-500 dark:text-stone-400 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="overflow-y-auto py-5 pr-1 space-y-6 flex-1 custom-scrollbar">
          
          <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed bg-theme-primary/5 dark:bg-stone-800/50 p-3.5 rounded-xl border border-theme-primary/10 dark:border-stone-800">
            Configure your focus domains. Your personal Companion Curator uses these preferences to assemble your custom ecosystem dispatch.
          </p>

          {/* 1. Naturalist Archetype */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Feather className="w-4 h-4 text-theme-accent" />
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                1. Naturalist Archetype Presets
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ARCHETYPE_PRESETS.map((preset) => {
                const isSelected = archetype === preset.title;
                return (
                  <button
                    key={preset.title}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`text-left p-3 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 min-h-[44px] ${
                      isSelected
                        ? 'border-theme-accent bg-theme-accent/10 text-theme-accent font-bold shadow-sm'
                        : 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 text-stone-800 dark:text-stone-200 hover:border-theme-primary/30'
                    }`}
                  >
                    <span className="font-display font-semibold text-xs line-clamp-1">{preset.title}</span>
                    {isSelected && <Check className="w-4 h-4 text-theme-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Primary Taxa Focus */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-theme-accent" />
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                2. Primary Taxa Focus
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {TAXA_OPTIONS.map((taxa) => {
                const isSelected = selectedTaxa.includes(taxa);
                return (
                  <button
                    key={taxa}
                    type="button"
                    onClick={() => toggleItem(selectedTaxa, setSelectedTaxa, taxa)}
                    className={`px-3.5 py-2.5 rounded-xl text-xs border font-medium transition-all cursor-pointer flex items-center gap-1.5 min-h-[40px] ${
                      isSelected
                        ? 'border-theme-accent bg-theme-accent/10 text-theme-accent font-bold'
                        : 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 text-stone-700 dark:text-stone-300 hover:border-theme-primary/30'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-theme-accent" />}
                    <span>{taxa}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Preferred Media Styles */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-theme-accent" />
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                3. Preferred Media Styles
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {STYLE_OPTIONS.map((style) => {
                const isSelected = selectedStyles.includes(style);
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() => toggleItem(selectedStyles, setSelectedStyles, style)}
                    className={`px-3.5 py-2.5 rounded-xl text-xs border font-medium transition-all cursor-pointer flex items-center gap-1.5 min-h-[40px] ${
                      isSelected
                        ? 'border-theme-accent bg-theme-accent/10 text-theme-accent font-bold'
                        : 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 text-stone-700 dark:text-stone-300 hover:border-theme-primary/30'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-theme-accent" />}
                    <span>{style}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Habitat Affinities */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Trees className="w-4 h-4 text-theme-accent" />
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                4. Habitat Affinities
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {HABITAT_OPTIONS.map((habitat) => {
                const isSelected = selectedHabitats.includes(habitat);
                return (
                  <button
                    key={habitat}
                    type="button"
                    onClick={() => toggleItem(selectedHabitats, setSelectedHabitats, habitat)}
                    className={`px-3.5 py-2.5 rounded-xl text-xs border font-medium transition-all cursor-pointer flex items-center gap-1.5 min-h-[40px] ${
                      isSelected
                        ? 'border-theme-accent bg-theme-accent/10 text-theme-accent font-bold'
                        : 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 text-stone-700 dark:text-stone-300 hover:border-theme-primary/30'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-theme-accent" />}
                    <span>{habitat}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Custom Naturalist Focus */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-theme-accent" />
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                5. Custom Research Focus (Optional)
              </label>
            </div>
            <textarea
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="e.g. High-altitude avian bioacoustics and moss canopy micro-habitats..."
              className="w-full bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 rounded-xl p-3 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-theme-accent min-h-[75px] resize-none"
            />
          </div>

        </div>

        {/* Sticky Actions Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-stone-900 z-10 pt-3 border-t border-theme-primary/10 dark:border-stone-800 flex items-center justify-between gap-3">
          {showSkipOption ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
            >
              Skip for Now
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-3 rounded-xl text-xs font-bold bg-theme-primary text-white hover:opacity-90 shadow-lg shadow-theme-primary/20 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-theme-accent" />
            <span>{isSaving ? "Saving Persona..." : "Activate Curated Dispatch"}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default NaturalistPersonaModal;

