import React, { useSyncExternalStore } from 'react';
import { getCurrentMark, subscribeMark, currentMarkUrl } from '../services/brandMark';

/**
 * NatureGram's mark exactly as the browser tab and home-screen icon show it: a disc in the
 * fortnight's colours (or the admin's branding) with the white sun. One mark everywhere.
 */
const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = '' }) => {
  const mark = useSyncExternalStore(subscribeMark, getCurrentMark, getCurrentMark);
  return (
    <img
      src={currentMarkUrl(mark)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${mark.custom ? 'rounded-[22%]' : 'rounded-full'} ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

export default BrandMark;
