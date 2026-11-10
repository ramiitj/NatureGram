import React from 'react';
import { CommunityPost } from '../types';
import ShareSheet from './ShareSheet';

/**
 * Kept for existing callers. The old publishing studio is folded into the share sheet:
 * the same plate preview and choices, plus saving the original specimen media.
 */
interface PublisherStudioProps {
  post: CommunityPost;
  activeItemIndex?: number;
  onClose: () => void;
  onSendLetter?: (post: CommunityPost) => void;
}

const PublisherStudio: React.FC<PublisherStudioProps> = ({ post, activeItemIndex = 0, onClose, onSendLetter }) => (
  <ShareSheet post={post} activeItemIndex={activeItemIndex} onClose={onClose} onSendLetter={onSendLetter} allowMediaDownload />
);

export default PublisherStudio;
