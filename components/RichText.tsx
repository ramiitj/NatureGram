import React from 'react';

/** Renders text with tappable @mentions and #hashtags (Instagram-style). */
const RichText: React.FC<{ text: string; onMention?: (username: string) => void; onTag?: (tag: string) => void; className?: string }> = ({ text, onMention, onTag, className }) => {
  const parts = text.split(/([@#][\p{L}\p{N}_.]{2,40})/gu);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.startsWith('@') && p.length > 2 && onMention) {
          return <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onMention(p.slice(1)); }} className="font-semibold text-theme-accent hover:underline">{p}</button>;
        }
        if (p.startsWith('#') && p.length > 2 && onTag) {
          return <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onTag(p); }} className="font-semibold text-theme-accent hover:underline">{p}</button>;
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </span>
  );
};

export default RichText;
