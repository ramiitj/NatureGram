
import React, { useState } from 'react';
import { CommunityPost } from '../types';
import { motion } from 'motion/react';

interface ShareStudioProps {
  post: CommunityPost;
  onClose: () => void;
}

const ShareStudio: React.FC<ShareStudioProps> = ({ post, onClose }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleShare = async () => {
    setIsSharing(true);
    try {
      let origin = window.location.origin;
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        origin = 'https://ais-pre-jzuicxor5ykd57l4xuevq4-414779155775.asia-east1.run.app';
      }
      const shareUrl = post.sourceUrl || `${origin}/s/${post.id}`;
      const title = post.title || 'Discovery';
      
      let text = post.description || '';
      if (text.length > 100) text = text.substring(0, 97) + '...';
      if (post.tags && post.tags.length > 0) {
        text += '\n' + post.tags.map((t: string) => t.startsWith('#') ? t : `#${t}`).join(' ');
      }

      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url: shareUrl
        });
        onClose();
      } else {
        await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
        setShowToast(true);
        setTimeout(() => { setShowToast(false); onClose(); }, 2000);
      }
    } catch (e) {
      console.log('Share cancelled or failed', e);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0" 
        onClick={onClose}
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative z-10 flex flex-col items-center gap-4"
      >
        {showToast ? (
            <div className="flex flex-col items-center gap-2 text-green-400">
                <span className="material-symbols-outlined text-5xl">check_circle</span>
                <span className="text-sm font-bold bg-black/50 px-4 py-2 rounded-full">Copied!</span>
            </div>
        ) : (
            <button 
                onClick={handleShare}
                disabled={isSharing}
                className="flex items-center gap-3 px-8 py-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/80 transition-all font-bold disabled:opacity-50"
            >
                {isSharing ? (
                    <>
                        <span className="material-symbols-outlined animate-spin">progress_activity</span>
                        Sharing...
                    </>
                ) : (
                    <>
                        <span className="material-symbols-outlined">ios_share</span>
                        Share
                    </>
                )}
            </button>
        )}
      </motion.div>
    </div>
  );
};

export default ShareStudio;
