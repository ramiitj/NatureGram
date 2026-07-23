import zlib from "node:zlib";

// Minimal, dependency-free PNG encoder — just enough to synthesize small
// deterministic test images for the eval harness's built-in fixtures
// without pulling in an image library (sharp/canvas) for a handful of
// solid-color/pattern test images.

const CRC_TABLE: number[] = (() => {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
};

// Encodes an 8-bit RGB, non-interlaced PNG by calling `pixel(x, y)` for
// every pixel. Fine for the small (tens of pixels) synthetic fixtures this
// harness needs — not a general-purpose image encoder.
export const encodePng = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // color type: truecolor (RGB)
    ihdrData[10] = 0; // compression method
    ihdrData[11] = 0; // filter method
    ihdrData[12] = 0; // interlace method
    const ihdr = chunk("IHDR", ihdrData);

    const stride = 1 + width * 3;
    const raw = Buffer.alloc(height * stride);
    let offset = 0;
    for (let y = 0; y < height; y++) {
        raw[offset++] = 0; // per-scanline filter type: none
        for (let x = 0; x < width; x++) {
            const [r, g, b] = pixel(x, y);
            raw[offset++] = r;
            raw[offset++] = g;
            raw[offset++] = b;
        }
    }

    const idat = chunk("IDAT", zlib.deflateSync(raw));
    const iend = chunk("IEND", Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
};
