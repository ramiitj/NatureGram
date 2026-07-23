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
  onStartExpedition?: () => void;
}

const Journal: React.FC<JournalProps> = ({
  userId,
  activeDraftsCount,
  onViewDrafts,
  onViewProfile,
  onPostOpen,
  onPostClose,
  onLogoClick,
  onStartExpedition
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
      onStartExpedition={onStartExpedition}
    />
  );
};

export default Journal;
