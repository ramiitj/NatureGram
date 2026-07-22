
import React from 'react';
import { motion } from 'motion/react';
import { Comment } from '../../types';

interface CommentsDrawerProps {
    comments: Comment[];
    newComment: string;
    onNewCommentChange: (value: string) => void;
    onSendComment: (e: React.FormEvent) => void;
    onClose: () => void;
    onProfileClick: (userId: string) => void;
}

const CommentsDrawer: React.FC<CommentsDrawerProps> = ({ comments, newComment, onNewCommentChange, onSendComment, onClose, onProfileClick }) => {
    return (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end p-0 bg-black/60 backdrop-blur-sm font-body">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0"
                onClick={onClose}
            />
            <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                drag="y"
                dragConstraints={{ top: 0 }}
                dragElastic={0.2}
                onDragEnd={(e, { offset, velocity }) => {
                    if (offset.y > 100 || velocity.y > 500) {
                        onClose();
                    }
                }}
                className="w-full max-w-md mx-auto bg-white rounded-t-[2.5rem] overflow-hidden shadow-2xl flex flex-col h-[75vh] relative z-10 pb-[env(safe-area-inset-bottom)]"
            >
                <div className="w-full flex justify-center pt-4 pb-2 shrink-0 cursor-grab active:cursor-grabbing">
                    <div className="w-12 h-1.5 bg-theme-primary/30 rounded-full"></div>
                </div>

                <div className="px-6 pb-4 flex justify-between items-center shrink-0 border-b border-theme-primary/10">
                    <h3 className="font-display font-black text-xl italic text-theme-primary">Field Notes</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary/60 hover:bg-theme-primary/20">
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {comments.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-theme-primary/40">
                            <span className="material-symbols-outlined text-4xl mb-2 opacity-50">forum</span>
                            <p className="text-xs font-medium">No field notes yet.</p>
                        </div>
                    ) : (
                        comments.map(c => (
                            <div key={c.id} className="animate-fade-in group">
                                <p onClick={() => { onClose(); onProfileClick(c.userId); }} className="text-[8px] font-black text-theme-primary/40 uppercase tracking-widest mb-1 leading-none cursor-pointer hover:text-theme-accent">{c.userName}</p>
                                <p className="text-[12px] text-theme-primary/80 leading-relaxed font-medium tracking-tight">{c.text}</p>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-theme-primary/10 bg-white shrink-0">
                    <form onSubmit={onSendComment} className="flex gap-2.5">
                        <input
                            value={newComment}
                            onChange={e => onNewCommentChange(e.target.value)}
                            placeholder="Append field note..."
                            className="flex-1 bg-theme-primary/5 border border-theme-primary/10 rounded-lg px-4 py-3 text-xs outline-none focus:border-theme-accent transition-colors font-semibold"
                        />
                        <button type="submit" disabled={!newComment.trim()} className="px-5 py-3 bg-theme-primary text-white text-[9px] font-black uppercase tracking-widest rounded-lg disabled:opacity-30 transition-all active:scale-95">
                            Log
                        </button>
                    </form>
                </div>
            </motion.div>
        </div>
    );
};

export default CommentsDrawer;
