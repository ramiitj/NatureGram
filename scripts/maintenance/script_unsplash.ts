import fs from 'fs';

const FIXES = {
  "wallace": "https://images.unsplash.com/photo-1542332213-9b5a5a3fad35?auto=format&fit=crop&q=80&w=1280",
  "carson": "https://images.unsplash.com/photo-1558285549-2a06fddb4b5e?auto=format&fit=crop&q=80&w=1280",
  "emerson": "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&q=80&w=1280",
  "leopold": "https://images.unsplash.com/photo-1506744626753-eda818318359?auto=format&fit=crop&q=80&w=1280",
  "attenborough": "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&q=80&w=1280",
  "cousteau": "https://images.unsplash.com/photo-1546026423-cc4642628d2b?auto=format&fit=crop&q=80&w=1280",
  "humboldt": "https://images.unsplash.com/photo-1621213032729-1959bdf11f26?auto=format&fit=crop&q=80&w=1280",
  "linnaeus": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=1280",
  "earle": "https://images.unsplash.com/photo-1582967788606-a171c1080cb0?auto=format&fit=crop&q=80&w=1280",
  "merian": "https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&q=80&w=1280"
};

const content = fs.readFileSync('constants/naturalists.ts', 'utf-8');

const newContent = content.replace(/id: '([^']+)',[\s\S]*?imageUrl: "(https:\/\/upload[^"]+)"/g, (match, id, url) => {
  if (FIXES[id]) {
    return match.replace(url, FIXES[id]);
  }
  return match;
});

fs.writeFileSync('constants/naturalists.ts', newContent);
console.log("Replaced with Unsplash");
