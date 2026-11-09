import fs from 'fs';
import crypto from 'crypto';

const fileContent = fs.readFileSync('constants/naturalists.ts', 'utf-8');

const updatedContent = fileContent.replace(/https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/([a-z0-9])\/([a-z0-9]{2})\/([^/]+)\/1280px-[^"']+/g, (match, p1, p2, filename) => {
    const decodedFilename = decodeURIComponent(filename).replace(/ /g, '_');
    const md5 = crypto.createHash('md5').update(decodedFilename).digest('hex');
    const newP1 = md5.substring(0, 1);
    const newP2 = md5.substring(0, 2);
    // Replace the URL with correctly computed hash
    const updatedUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/${newP1}/${newP2}/${filename}/1280px-${filename}`;
    if (match !== updatedUrl) {
        console.log(`Updated ${filename}: ${match} -> ${updatedUrl}`);
    }
    return updatedUrl;
});

fs.writeFileSync('constants/naturalists.ts', updatedContent);
console.log("Done");
