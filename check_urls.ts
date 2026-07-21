import { NATURALIST_THEMES } from './constants/naturalists.ts';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkUrls() {
  for (const theme of NATURALIST_THEMES) {
    try {
      const resp = await fetch(theme.imageUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'NatureGram Test Script (researchsme2020@gmail.com)'
        }
      });
      console.log(theme.id, resp.status);
      if (resp.status !== 200) {
        console.log("Failed:", theme.imageUrl);
      }
    } catch (e) {
      console.log(theme.id, e.message);
    }
    await sleep(200);
  }
}

checkUrls();
