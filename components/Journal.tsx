import React from 'react';
import Community from './Community';

interface JournalProps {
  userId: string;
  activeDraftsCount?: number;
  onViewDrafts?: () => void;
  onViewProfile?: (userId: string) => void;
  onPostOpen?: () => void;
  onPostClose?: () => void;
  onLogoClick?: () => void;
}

const Journal: React.FC<JournalProps> = ({ 
  userId, 
  activeDraftsCount, 
  onViewDrafts, 
  onViewProfile, 
  onPostOpen, 
  onPostClose,
  onLogoClick
}) => {
  return (
    <Community 
      currentUserMode={{ type: 'community', userId }} 
      isJournalOnly={true} 
      backLabel="Profile"
      activeDraftsCount={activeDraftsCount}
      onViewDrafts={onViewDrafts}
      onViewProfile={onViewProfile}
      onPostOpen={onPostOpen}
      onPostClose={onPostClose}
      onLogoClick={onLogoClick}
    />
  );
};

export default Journal;
