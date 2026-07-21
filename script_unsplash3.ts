import fs from 'fs';

let content = fs.readFileSync('constants/naturalists.ts', 'utf-8');

content = content.replace("https://images.unsplash.com/photo-1558285549-2a06fddb4b5e?auto=format&fit=crop&q=80&w=1280", "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&q=80&w=1280");
content = content.replace("https://images.unsplash.com/photo-1506744626753-eda818318359?auto=format&fit=crop&q=80&w=1280", "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?auto=format&fit=crop&q=80&w=1280");

fs.writeFileSync('constants/naturalists.ts', content);
console.log("Done");
