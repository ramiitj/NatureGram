import React, { useState } from 'react';
import { CommunityPost } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface PublisherStudioProps {
  post: CommunityPost;
  activeItemIndex?: number;
  onClose: () => void;
}

const PublisherStudio: React.FC<PublisherStudioProps> = ({ post, activeItemIndex = 0, onClose }) => {
  const [downloading, setDownloading] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Active item logic
  const currentItem = post.items && post.items.length > 0 ? post.items[activeItemIndex] : post;
  
  // Construct URL
  let origin = window.location.origin;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    origin = 'https://ais-pre-jzuicxor5ykd57l4xuevq4-414779155775.asia-east1.run.app';
  }
  const shareUrl = post.sourceUrl || `${origin}/s/${post.id}`;

  const title = post.title || 'Specimen Discovery';
  const rawDescription = post.description || '';
  const ecologicalInsight = currentItem.aiInsight || post.aiInsight || '';
  
  // Format description with tags
  const tagsStr = post.tags && post.tags.length > 0 
    ? post.tags.map((t: string) => t.startsWith('#') ? t : `#${t}`).join(' ') 
    : '#NatureGram #NatureDiscovery';
  
  const cleanText = (str: string) => str ? str.replace(/[*"]/g, '').trim() : '';
  let formattedShareText = `🌿 ${cleanText(title)} on NatureGram`;

  if (rawDescription.trim()) {
      formattedShareText += `\n\n${cleanText(rawDescription)}`;
  }

  if (ecologicalInsight && ecologicalInsight !== 'Processing...' && ecologicalInsight !== 'Audio analysis pending...') {
    formattedShareText += `\n\n🔍 Ecological Analysis:\n${cleanText(ecologicalInsight)}`;
  }

  formattedShareText += `\n\nTags: ${tagsStr}\n\nView original discovery log here:\n${shareUrl}`;

  // Get active media URL
  let mediaUrl = '';
  let extension = 'jpg';
  if (currentItem.mediaType === 'video') {
    mediaUrl = currentItem.videoUrl || '';
    extension = 'mp4';
  } else if (currentItem.mediaType === 'audio') {
    mediaUrl = currentItem.audioUrl || '';
    extension = 'mp3';
  } else {
    mediaUrl = currentItem.imageUrl || currentItem.thumbnailUrl || '';
    extension = 'jpg';
  }

  const handleDownload = async () => {
    if (!mediaUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(mediaUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Network response not ok');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `naturegram-specimen-${post.id}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.warn('CORS or fetch blocked download, falling back to open in tab:', e);
      // Fallback: Open in new window/tab as a safe fallback
      const win = window.open(mediaUrl, '_blank');
      if (win) win.focus();
    } finally {
      setDownloading(false);
    }
  };

  const copyTextToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(formattedShareText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch (e) {
      console.error('Failed to copy text', e);
    }
  };

  const copyLinkToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error('Failed to copy link', e);
    }
  };

  // Launch Socials
  const launchWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(formattedShareText)}`;
    window.open(url, '_blank');
  };

  const launchFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank');
  };

  const launchLinkedIn = () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank');
  };

  const launchInstagram = () => {
    // Open instagram.com and notify user to paste
    const url = 'https://www.instagram.com/';
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 md:p-6 bg-stone-950/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0" 
        onClick={onClose}
      />
      
      <motion.div 
        initial={{ scale: 0.95, y: 15, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 15, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="relative z-10 w-full max-w-lg bg-white rounded-3xl overflow-hidden border border-stone-200/60 shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-700 text-2xl">campaign</span>
            <div>
              <h3 className="text-sm font-black font-display text-stone-900 tracking-tight uppercase">Publisher Studio</h3>
              <p className="text-[10px] text-stone-500 font-medium tracking-wide">Optimize speciman for social distribution</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-500 active:scale-90 transition-all"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-left">
          
          {/* Formatted Caption Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase text-stone-400 tracking-wider">Formatted Message Caption</span>
              <button 
                onClick={copyTextToClipboard} 
                className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">{copiedText ? 'done' : 'content_copy'}</span>
                <span>{copiedText ? 'Copied' : 'Copy Text'}</span>
              </button>
            </div>
            
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200/50 font-sans text-xs text-stone-700 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap select-text">
              {formattedShareText}
            </div>
          </div>

          {/* Quick Assets Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={handleDownload} 
              disabled={downloading}
              className="flex flex-col items-center justify-center p-4 rounded-2xl border border-stone-200 hover:border-emerald-200 hover:bg-emerald-50/20 active:scale-[0.98] transition-all group gap-2 text-center"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center transition-colors group-hover:bg-emerald-100">
                {downloading ? (
                  <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-lg">download</span>
                )}
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-stone-800">Download Specimen</p>
                <p className="text-[8px] text-stone-400 uppercase font-bold">{extension === 'mp4' ? 'Video File' : extension === 'mp3' ? 'Audio File' : 'HQ Image'}</p>
              </div>
            </button>

            <button 
              onClick={copyLinkToClipboard}
              className="flex flex-col items-center justify-center p-4 rounded-2xl border border-stone-200 hover:border-emerald-200 hover:bg-emerald-50/20 active:scale-[0.98] transition-all group gap-2 text-center"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center transition-colors group-hover:bg-emerald-100">
                <span className="material-symbols-outlined text-lg">{copiedLink ? 'check_circle' : 'link'}</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-stone-800">{copiedLink ? 'Link Copied!' : 'Copy Share Link'}</p>
                <p className="text-[8px] text-stone-400 uppercase font-bold">OG Meta Link</p>
              </div>
            </button>
          </div>

          {/* Platform Launchers */}
          <div className="space-y-3">
            <span className="text-[9px] font-black uppercase text-stone-400 tracking-wider">Select Publishing Destination</span>
            
            <div className="grid grid-cols-2 gap-3">
              {/* WhatsApp */}
              <button 
                onClick={launchWhatsApp}
                className="flex items-center gap-3 p-3.5 rounded-2xl border border-stone-100 hover:border-emerald-400 bg-stone-50 hover:bg-emerald-50/30 transition-all text-left active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.717-1.456L0 24zm6.59-4.846c1.66.986 3.288 1.498 5.41 1.499 5.485.002 9.947-4.46 9.949-9.951.001-2.66-1.011-5.161-2.851-7.005-1.839-1.844-4.283-2.86-6.942-2.86-5.486 0-9.949 4.459-9.951 9.95-.001 2.059.529 4.07 1.534 5.761L2.73 21.27l4.137-1.083z"/>
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wide">WhatsApp</h4>
                  <p className="text-[9px] text-stone-400">Share text + link directly</p>
                </div>
              </button>

              {/* Instagram */}
              <button 
                onClick={launchInstagram}
                className="flex items-center gap-3 p-3.5 rounded-2xl border border-stone-100 hover:border-pink-400 bg-stone-50 hover:bg-pink-50/30 transition-all text-left active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 text-white flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wide">Instagram</h4>
                  <p className="text-[9px] text-stone-400">Launch & drag-and-drop info</p>
                </div>
              </button>

              {/* LinkedIn */}
              <button 
                onClick={launchLinkedIn}
                className="flex items-center gap-3 p-3.5 rounded-2xl border border-stone-100 hover:border-blue-400 bg-stone-50 hover:bg-blue-50/30 transition-all text-left active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wide">LinkedIn</h4>
                  <p className="text-[9px] text-stone-400">Feed post with full metadata</p>
                </div>
              </button>

              {/* Facebook */}
              <button 
                onClick={launchFacebook}
                className="flex items-center gap-3 p-3.5 rounded-2xl border border-stone-100 hover:border-blue-700 bg-stone-50 hover:bg-blue-50/10 transition-all text-left active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-[#1877F2] text-white flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wide">Facebook</h4>
                  <p className="text-[9px] text-stone-400">Pristine image preview post</p>
                </div>
              </button>
            </div>
          </div>

          {/* Guidelines info */}
          <div className="p-3.5 bg-stone-50/80 rounded-2xl border border-stone-100 flex gap-2.5 items-start">
            <span className="material-symbols-outlined text-[15px] text-emerald-700 font-bold shrink-0 mt-0.5">info</span>
            <p className="text-[9px] font-medium text-stone-500 leading-normal uppercase tracking-wide">
              PRO TIP: Click "Download Specimen" to save the pristine media asset. Click "Copy Text" to get your formatted description and tags. When you launch Instagram or Facebook, simply choose your downloaded media and paste the copied caption in one tab!
            </p>
          </div>

        </div>
      </motion.div>
    </div>
  );
};

export default PublisherStudio;
