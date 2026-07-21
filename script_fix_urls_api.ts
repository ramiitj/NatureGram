import fs from 'fs';
import { NATURALIST_THEMES } from './constants/naturalists.ts';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fixUrls() {
  const content = fs.readFileSync('constants/naturalists.ts', 'utf-8');
  let newContent = content;
  
  const files = [
    "Mount_Gamalama_from_Ternate.jpg",
    "Devil's_Lake_State_Park_-_East_Bluff_View.jpg",
    "Ralph_Waldo_Emerson_House_Concord_MA.jpg",
    "Serengeti_National_Park_-_Zebras_01.jpg",
    "Coral_reef_in_the_Red_Sea.jpg",
    "Chimborazo_from_Riobamba.jpg",
    "Möckeln_sommar.jpg",
    "Flower_Garden_Banks_NMS_ROV_Coral_Reef.jpg",
    "Suriname_rainforest_1.jpg"
  ];

  for (const filename of files) {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json`;
    try {
      const resp = await fetch(apiUrl, { headers: { 'User-Agent': 'NatureGram Test Script' } });
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId !== '-1') {
          const imageinfo = pages[pageId].imageinfo;
          if (imageinfo && imageinfo.length > 0) {
            const thumburl = imageinfo[0].thumburl;
            console.log(`Fix for ${filename}: ${thumburl}`);
            
            // replace in content
            const encodedFilename = encodeURIComponent(filename);
            const regexStr = `https://upload\\.wikimedia\\.org/wikipedia/commons/thumb/[a-z0-9]/[a-z0-9]{2}/${encodedFilename.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')}/1280px-[^"']+`;
            const regex = new RegExp(regexStr);
            newContent = newContent.replace(regex, thumburl);
          }
        }
      } catch(e) {
          console.log(`Rate limit parsing ${filename}`);
      }
    } catch (e) {
      console.log(`Error for ${filename}:`, e);
    }
    await sleep(2000); // 2 second pause to avoid rate limit
  }

  fs.writeFileSync('constants/naturalists.ts', newContent);
  console.log("Done");
}

fixUrls();
