
import React, { useState, useEffect } from 'react';

interface OnboardingTourProps {
  onComplete: () => void;
}

const STEPS = [
  {
    id: "brain",
    title: "The Multi-Sensory Brain",
    description: "This is your AI Guide. It sees what you see and hears what you hear. It watches the camera feed to identify species and listens to the environment.",
    // Spotlight Coordinates (approximate percentages for responsive layout)
    x: 50,
    y: 12, 
    radius: 80,
    cardPosition: "top-[25%]" 
  },
  {
    id: "vision",
    title: "Cinematic Vision",
    description: "Transcripts appear here as dynamic captions. You don't need to read a chat log—just watch the world.",
    x: 50,
    y: 50,
    radius: 140,
    cardPosition: "bottom-[20%]"
  },
  {
    id: "tools",
    title: "Explorer Tools",
    description: "Tap the Shutter to capture a photo. Hold it to record up to 30s of video. Use the Mic for audio-only. The AI yields when you talk.",
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

  const finishTour = () => {
    localStorage.setItem('naturegram_has_seen_tour', 'true');
    setIsVisible(false);
    setTimeout(onComplete, 300);
  };

  if (!isVisible) return null;

  const step = STEPS[stepIndex];

  return (
    <div className="fixed inset-0 z-[100] font-body pointer-events-auto">
      {/* 
        THE SPOTLIGHT MASK 
        We use a radial-gradient mask to make the target area transparent (revealing the UI below)
        and the rest opaque dark.
      */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]"
        style={{
            maskImage: `radial-gradient(circle ${step.radius}px at ${step.x}% ${step.y}%, transparent 0%, black 100%)`,
            WebkitMaskImage: `radial-gradient(circle ${step.radius}px at ${step.x}% ${step.y}%, transparent 0%, black 100%)`
        }}
      >
          {/* Optional: Add a subtle glowing ring around the hole to frame the UI */}
          <div 
            className="absolute rounded-full border-2 border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]"
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
      <div className={`absolute left-0 right-0 mx-auto w-[85%] max-w-sm transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] ${step.cardPosition}`}>
          <div className="glass-panel bg-white/95 rounded-2xl p-6 shadow-2xl border border-white/50 relative overflow-hidden">
             
             {/* Decorative 'Paper' Header */}
             <div className="flex justify-between items-center mb-4 border-b border-theme-primary/10 pb-3">
                 <div className="flex items-center gap-2">
                     <span className="material-symbols-outlined text-[16px] text-theme-accent select-none">explore</span>
                     <span className="text-[10px] uppercase tracking-widest font-bold text-theme-primary/40">Field Guide</span>
                 </div>
                 <button onClick={finishTour} className="text-theme-primary/40 hover:text-theme-accent transition-colors text-xs font-bold uppercase tracking-widest">
                     Skip
                 </button>
             </div>

             {/* Content */}
             <h3 className="text-2xl font-display font-black text-theme-primary mb-2 tracking-tight">
                 {step.title}
             </h3>
             <p className="text-theme-primary/70 text-sm leading-relaxed mb-6">
                 {step.description}
             </p>

             {/* Navigation */}
             <div className="flex justify-between items-center">
                 <div className="flex gap-1.5">
                     {STEPS.map((_, i) => (
                         <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === stepIndex ? 'w-8 bg-theme-accent' : 'w-2 bg-theme-primary/30'}`}></div>
                     ))}
                 </div>
                 <button 
                    onClick={handleNext} 
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
