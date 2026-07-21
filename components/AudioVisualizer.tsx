import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  color?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, color = 'bg-primary' }) => {
  return (
    <div className="flex items-center gap-1.5 h-16" aria-label="Audio Visualizer">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full ${color} transition-all duration-300 ${
            isActive ? `animate-wave-bar` : 'h-1.5 opacity-50'
          }`}
          style={{
            height: isActive ? `${Math.max(20, Math.random() * 100)}%` : '6px',
            animationDelay: `${i * 0.1}s`,
            animationDuration: '1s'
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
