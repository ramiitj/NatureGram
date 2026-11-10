import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  color?: string;
}

// Fixed bar heights (a soft hill shape) so the bars don't jump on every re-render
const HEIGHTS = [38, 62, 84, 100, 92, 70, 52, 34];

/** The guide's voice as a few quiet bars; decorative, so screen readers skip it. */
const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, color = 'bg-primary' }) => {
  return (
    <div className="flex items-center gap-1.5 h-16" aria-hidden="true">
      {HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full ${color} transition-all duration-300 ${
            isActive ? 'motion-safe:animate-wave-bar' : 'opacity-50'
          }`}
          style={{
            height: isActive ? `${h}%` : '6px',
            animationDelay: `${i * 0.1}s`,
            animationDuration: '1s'
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
