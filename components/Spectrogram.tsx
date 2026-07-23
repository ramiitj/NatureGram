import React, { useEffect, useRef } from 'react';

interface SpectrogramProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  // Nyquist-limited display ceiling — most bioacoustic signal of interest
  // (bird/insect/amphibian calls) sits well under this, and capping it
  // keeps the visible frequency axis meaningful instead of stretching to
  // whatever the input sample rate's Nyquist happens to be.
  maxFrequencyHz?: number;
  className?: string;
}

// A real scrolling frequency-over-time spectrogram (frequency bin on the Y
// axis, time scrolling left on the X axis, amplitude as color intensity) —
// replaces AudioVisualizer's decorative random-height bars for the one
// surface (Live sound capture) where a genuine bioacoustic visualization is
// the actual point, not a UI flourish.
const Spectrogram: React.FC<SpectrogramProps> = ({ analyser, isActive, maxFrequencyHz = 10000, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!isActive || !analyser) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    if (!dataArrayRef.current || dataArrayRef.current.length !== bufferLength) {
      dataArrayRef.current = new Uint8Array(bufferLength);
    }
    const dataArray = dataArrayRef.current;

    // Only render bins up to maxFrequencyHz — analyser.context.sampleRate/2
    // is the true Nyquist ceiling for this bufferLength.
    const nyquist = analyser.context.sampleRate / 2;
    const binsToShow = Math.max(1, Math.min(bufferLength, Math.round((maxFrequencyHz / nyquist) * bufferLength)));

    // Amplitude (0-255) -> a blue/purple/orange/yellow heat scale, drawn
    // per-pixel. Cheap enough to compute inline per column since only
    // `binsToShow` pixels are touched per frame.
    const colorForAmplitude = (v: number): string => {
      const t = v / 255;
      if (t < 0.25) {
        // near-silence: dark blue-black
        const l = t / 0.25;
        return `rgb(${Math.round(10 + l * 20)}, ${Math.round(10 + l * 10)}, ${Math.round(30 + l * 60)})`;
      } else if (t < 0.55) {
        const l = (t - 0.25) / 0.3;
        return `rgb(${Math.round(30 + l * 90)}, ${Math.round(20 + l * 20)}, ${Math.round(90 + l * 80)})`;
      } else if (t < 0.8) {
        const l = (t - 0.55) / 0.25;
        return `rgb(${Math.round(120 + l * 135)}, ${Math.round(40 + l * 90)}, ${Math.round(170 - l * 100)})`;
      }
      const l = (t - 0.8) / 0.2;
      return `rgb(255, ${Math.round(130 + l * 110)}, ${Math.round(70 - l * 70)})`;
    };

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;

      // Scroll existing content one pixel to the left, then draw the new
      // frame's column at the rightmost pixel — the standard scrolling-
      // spectrogram technique, done via canvas self-copy rather than
      // redrawing history every frame.
      ctx.drawImage(canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);

      const pixelsPerBin = height / binsToShow;
      for (let bin = 0; bin < binsToShow; bin++) {
        const amplitude = dataArray[bin];
        ctx.fillStyle = colorForAmplitude(amplitude);
        // Low frequencies at the bottom, high at the top — the
        // conventional spectrogram orientation.
        const y = height - Math.ceil((bin + 1) * pixelsPerBin);
        ctx.fillRect(width - 1, y, 1, Math.ceil(pixelsPerBin) + 1);
      }
    };

    // Start from a blank (silent) canvas rather than whatever pixels a
    // previous session left behind.
    ctx.fillStyle = 'rgb(10, 10, 25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    draw();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, isActive, maxFrequencyHz]);

  return (
    <div className={`relative ${className}`} aria-label="Live audio spectrogram">
      <canvas
        ref={canvasRef}
        width={280}
        height={120}
        className="w-full h-full rounded-2xl border border-white/10"
      />
      <div className="absolute top-1 right-2 text-[8px] font-mono text-white/40">{(maxFrequencyHz / 1000).toFixed(0)}kHz</div>
      <div className="absolute bottom-1 right-2 text-[8px] font-mono text-white/40">0kHz</div>
    </div>
  );
};

export default Spectrogram;
