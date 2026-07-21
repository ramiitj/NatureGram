
import React from 'react';

const SkeletonPost: React.FC = () => {
  return (
    <div className="relative break-inside-avoid animate-pulse">
      <div className="bg-theme-primary/10 rounded-lg aspect-[3/4] w-full mb-2"></div>
      <div className="h-3 bg-theme-primary/10 rounded w-3/4 mb-1 mx-1"></div>
      <div className="h-2 bg-theme-primary/10 rounded w-1/2 mx-1"></div>
    </div>
  );
};

export default SkeletonPost;
