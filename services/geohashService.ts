// Standard geohash encoding (the geohash.org algorithm — base32, interleaved
// lat/lng bit precision) — dependency-free, since this is the only
// operation needed (indexing observations for the species map, T4), not a
// full geospatial query library.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const encodeGeohash = (lat: number, lng: number, precision = 9): string => {
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let hash = '';
    let bit = 0;
    let ch = 0;
    let isLng = true;

    while (hash.length < precision) {
        if (isLng) {
            const mid = (lngMin + lngMax) / 2;
            if (lng >= mid) { ch |= (1 << (4 - bit)); lngMin = mid; } else { lngMax = mid; }
        } else {
            const mid = (latMin + latMax) / 2;
            if (lat >= mid) { ch |= (1 << (4 - bit)); latMin = mid; } else { latMax = mid; }
        }
        isLng = !isLng;
        if (bit < 4) {
            bit++;
        } else {
            hash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
};

// Great-circle distance in kilometers (haversine) — used client-side to
// sort mapped observations nearest-first when the viewer's own location is
// available, rather than running a full geohash bounding-box query.
export const haversineDistanceKm = (a: { lat: number, lng: number }, b: { lat: number, lng: number }): number => {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};
