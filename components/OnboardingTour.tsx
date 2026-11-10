
import React, { useState, useEffect } from 'react';
import Glyph from './Glyph';

interface OnboardingTourProps {
  onComplete: () => void;
}

const STEPS = [
  {
    id: "brain",
    title: "Meet your guide",
    description: "Your guide sees what your camera sees and hears what you hear. Just point it at anything alive and ask questions out loud. Its status shows here.",
    // Spotlight Coordinates (approximate percentages for responsive layout)
    x: 50,
    y: 12, 
    radius: 80,
    cardPosition: "top-[25%]" 
  },
  {
    id: "vision",
    title: "Listen, then look closer",
    description: "What your guide says appears as captions here. Missed something? Tap Transcript (top left) to read it all back.",
    x: 50,
    y: 50,
    radius: 140,
    cardPosition: "bottom-[20%]"
  },
  {
    id: "tools",
    title: "Capture the moment",
    description: "Tap the shutter for a photo, hold it for up to 30 s of video. Tap Sound to record a bird call. Talk mutes and unmutes your voice. Tap Done to review and share. The guide can be wrong, so you have the final say.",
    x: 50,
    y: 88, 
    radius: 100,
    cardPosition: "bottom-[35%]"
  }
];

const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem('naturegram_has_seen_tour');
    if (!hasSeen) {
      setIsVisible(true);
    } else {
      onComplete();
    }
  }, [onComplete]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(prev => prev + 1);
    } else {
      finishTour();
    }
  };

  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishTour();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') setStepIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finishTour = () => {
    localStorage.setItem('naturegram_has_seen_tour', 'true');
    setIsVisible(false);
    setTimeout(onComplete, 300);
  };

  if (!isVisible) return null;

  const step = STEPS[stepIndex];

  return (
    <div className="fixed inset-0 z-[100] font-body pointer-events-auto" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-desc">
      {/* 
        THE SPOTLIGHT MASK 
        We use a radial-gradient mask to make the target area transparent (revealing the UI below)
        and the rest opaque dark.
      */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-all duration-700 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
        style={{
            maskImage: `radial-gradient(circle ${step.radius}px at ${step.x}% ${step.y}%, transparent 0%, black 100%)`,
            WebkitMaskImage: `radial-gradient(circle ${step.radius}px at ${step.x}% ${step.y}%, transparent 0%, black 100%)`
        }}
      >
          {/* Optional: Add a subtle glowing ring around the hole to frame the UI */}
          <div 
            className="absolute rounded-full border-2 border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all duration-700 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
            style={{
                left: `${step.x}%`,
                top: `${step.y}%`,
                width: `${step.radius * 2}px`,
                height: `${step.radius * 2}px`,
                transform: 'translate(-50%, -50%)'
            }}
          ></div>
      </div>

      {/* THE FIELD NOTE CARD */}
      <div className={`absolute left-0 right-0 mx-auto w-[85%] max-w-sm transition-all duration-700 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)] ${step.cardPosition}`}>
          <div className="glass-panel bg-white/95 rounded-2xl p-6 shadow-2xl border border-white/50 relative overflow-hidden">
             
             {/* Decorative 'Paper' Header */}
             <div className="flex justify-between items-center mb-4 border-b border-theme-primary/10 pb-3">
                 <div className="flex items-center gap-2">
                     <Glyph name="guide" size={18} className="text-theme-accent" />
                     <span className="text-sm font-display text-theme-primary/70">A word from your guide</span>
                 </div>
                 <button onClick={finishTour} className="text-stone-600 hover:text-stone-900 transition-colors text-sm font-bold px-2 py-1">
                     Skip tour
                 </button>
             </div>

             {/* Content */}
             <h3 id="tour-title" className="text-2xl font-display font-semibold text-stone-900 mb-2">
                 {step.title}
             </h3>
             <p id="tour-desc" className="text-stone-700 text-base leading-relaxed mb-6">
                 {step.description}
             </p>

             {/* Navigation */}
             <div className="flex justify-between items-center">
                 <div className="flex items-center gap-3">
                     {stepIndex > 0 && (
                         <button onClick={() => setStepIndex(i => i - 1)} className="text-sm font-bold text-stone-600 px-2 py-2">Back</button>
                     )}
                     <div className="flex gap-1.5" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
                         {STEPS.map((_, i) => (
                             <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === stepIndex ? 'w-8 bg-theme-accent' : 'w-2 bg-stone-300'}`}></div>
                         ))}
                     </div>
                 </div>
                 <button 
                    onClick={handleNext} 
                    autoFocus
                    className="flex items-center gap-2 bg-theme-primary text-white pl-5 pr-4 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-black transition-transform active:scale-95"
                 >
                     <span>{stepIndex === STEPS.length - 1 ? "Start" : "Next"}</span>
                     <span className="material-symbols-outlined text-sm">arrow_forward</span>
                 </button>
             </div>

             {/* Background Decoration */}
             <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-theme-accent/5 rounded-full blur-2xl pointer-events-none"></div>
          </div>
      </div>
    </div>
  );
};

export default OnboardingTour;
