import fs from 'fs';

const FIXES = {
  "carson": "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&q=80&w=1280",
  "leopold": "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?auto=format&fit=crop&q=80&w=1280",
  "humboldt": "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&q=80&w=1280"
};

const content = fs.readFileSync('constants/naturalists.ts', 'utf-8');

const newContent = content.replace(/id: '([^']+)',[\s\S]*?imageUrl: "(https:\/\/images\.unsplash[^"]+)"/g, (match, id, url) => {
  if (FIXES[id]) {
    return match.replace(url, FIXES[id]);
  }
  return match;
});

fs.writeFileSync('constants/naturalists.ts', newContent);
console.log("Replaced remaining 3");
