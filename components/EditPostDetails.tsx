import React, { useState } from 'react';
import { CommunityPost, CommunityPostItem } from '../types';

interface EditPostDetailsProps {
  post: CommunityPost;
  activeItemIndex: number;
  onSave: (updates: Partial<CommunityPost>) => void;
  onCancel: () => void;
}

const parseCsv = (value: string): string[] =>
  value.split(',').map(s => s.trim()).filter(Boolean);

const EditPostDetails: React.FC<EditPostDetailsProps> = ({ post, activeItemIndex, onSave, onCancel }) => {
  const hasMultipleItems = !!post.items && post.items.length > 0;
  const currentItem: CommunityPostItem | CommunityPost = hasMultipleItems ? post.items![activeItemIndex] : post;

  const [title, setTitle] = useState(post.title || '');
  const [description, setDescription] = useState(post.description || '');
  const [tags, setTags] = useState((post.tags || []).join(', '));
  const [labels, setLabels] = useState((currentItem.labels || []).join(', '));
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    const newLabels = parseCsv(labels);
    // A correction signal for later analysis: did the human's final labels
    // diverge from what the AI originally proposed? Mirrors the pre-publish
    // check in PostSessionView so the signal keeps working after publish too.
    const baseline = currentItem.aiProposedLabels || currentItem.labels || [];
    const labelsChanged = JSON.stringify(newLabels) !== JSON.stringify(baseline);
    const newHumanDelta = currentItem.humanDelta || labelsChanged;

    const updates: Partial<CommunityPost> = {
        title: title.trim(),
        description: description.trim(),
        tags: parseCsv(tags),
    };

    if (hasMultipleItems) {
        const newItems = [...post.items!];
        newItems[activeItemIndex] = { ...newItems[activeItemIndex], labels: newLabels, humanDelta: newHumanDelta };
        updates.items = newItems;
        if (activeItemIndex === 0) {
            updates.labels = newLabels;
            updates.humanDelta = newHumanDelta;
        }
    } else {
        updates.labels = newLabels;
        updates.humanDelta = newHumanDelta;
    }

    onSave(updates);
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 animate-fade-in">
      <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-md" onClick={onCancel}></div>
      <div className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-slide-up max-h-[85vh] flex flex-col">
        <div className="p-8 pb-4 shrink-0">
          <h2 className="text-2xl font-display font-black italic text-stone-900 mb-1">Edit Details</h2>
          <p className="text-xs text-stone-500 uppercase tracking-widest font-bold">Title, caption, taxonomy, and tags</p>
        </div>

        <div className="px-8 space-y-5 overflow-y-auto flex-1">
          <label className="block">
            <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all"
              placeholder="Untitled Observation"
            />
          </label>

          <label className="block">
            <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Caption</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all resize-none"
              placeholder="Add a caption..."
            />
          </label>

          <label className="block">
            <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Taxonomy (comma-separated)</span>
            <input
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all"
              placeholder="e.g. Northern Cardinal, Sugar Maple"
            />
          </label>

          <label className="block">
            <span className="catalog-label text-[9px] text-stone-500 block mb-1.5">Tags (comma-separated)</span>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl text-sm font-medium outline-none focus:border-theme-accent/50 transition-all"
              placeholder="e.g. urbanwild, backyard"
            />
          </label>
        </div>

        <div className="p-8 pt-6 flex gap-3 shrink-0">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 py-4 rounded-2xl border-2 border-stone-100 text-stone-500 font-black text-xs uppercase tracking-widest hover:bg-stone-50 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-4 rounded-2xl bg-theme-accent text-white font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditPostDetails;
