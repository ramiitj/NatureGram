import React from 'react';
import { CommunityPost } from '../types';
import ShareSheet from './ShareSheet';

/** Kept for existing callers: the share sheet with the plate preview (see ShareSheet). */
interface ShareStudioProps {
  post: CommunityPost;
  onClose: () => void;
  onSendLetter?: (post: CommunityPost) => void;
}

const ShareStudio: React.FC<ShareStudioProps> = ({ post, onClose, onSendLetter }) => (
  <ShareSheet post={post} onClose={onClose} onSendLetter={onSendLetter} />
);

export default ShareStudio;
