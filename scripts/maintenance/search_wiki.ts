import fs from 'fs';

async function fetchWikiImage(query: string) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=pageimages&format=json&pithumbsize=1280`);
    const data = await res.json();
    return Object.values(data.query?.pages || {}).map((p: any) => p.thumbnail?.source).filter(Boolean);
}

async function run() {
    console.log("Linnaeus:");
    const smaland = await fetchWikiImage("Smaland nature");
    console.log(smaland);

    console.log("Earle:");
    const gulf = await fetchWikiImage("Gulf of Mexico coral");
    console.log(gulf);
}
run();
