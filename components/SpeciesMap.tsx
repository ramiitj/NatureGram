import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CommunityPost } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { haversineDistanceKm } from '../services/geohashService';

interface SpeciesMapProps {
  onBack: () => void;
  onSelectPost: (postId: string) => void;
}

// A biodiversity app without a map is missing its most scientific and most
// compelling surface (T4/V2). Uses raw Leaflet (not react-leaflet) directly
// against a ref — one fewer dependency, and it sidesteps the well-known
// Leaflet-default-marker-icon-path-breaks-under-bundlers problem entirely
// by using styled DivIcons instead of Leaflet's default image markers.
const SpeciesMap: React.FC<SpeciesMapProps> = ({ onBack, onSelectPost }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nearestCount, setNearestCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    FirebaseService.getMappableObservations().then(result => {
      if (cancelled) return;
      setPosts(result);
      setIsLoading(false);
    }).catch(e => {
      if (cancelled) return;
      console.error('Failed to load mappable observations:', e);
      setError('Could not load the species map.');
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Best-effort recentering on the viewer's own location — purely a
    // starting viewport, never a filter (the underlying query is global;
    // see getMappableObservations). Silently no-ops if denied/unavailable.
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 8),
        () => {},
        { timeout: 5000 }
      );
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    let viewerLoc: { lat: number, lng: number } | null = null;

    const addMarkers = () => {
      let nearby = 0;
      posts.forEach(post => {
        if (!post.rawLocation) return;
        const { lat, lng } = post.rawLocation;
        if (viewerLoc && haversineDistanceKm(viewerLoc, { lat, lng }) < 50) nearby++;

        const icon = L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;border-radius:50%;background:var(--theme-accent, #ea580c);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const marker = L.marker([lat, lng], { icon });
        const label = post.labels?.[0] || 'Observation';
        const thumb = post.thumbnailUrl || post.imageUrl;
        marker.bindPopup(`
          <div style="font-family: inherit; min-width: 160px;">
            ${thumb ? `<img src="${thumb}" style="width:100%;height:90px;object-fit:cover;border-radius:8px;margin-bottom:6px;" />` : ''}
            <strong style="font-size:12px;">${label}</strong><br/>
            <span style="font-size:10px;color:#888;">${post.locationArea || ''}</span>
          </div>
        `);
        marker.on('popupopen', () => {
          const el = document.querySelector('.leaflet-popup-content');
          el?.addEventListener('click', () => onSelectPost(post.id));
        });
        marker.addTo(layer);
      });
      setNearestCount(nearby);
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { viewerLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; addMarkers(); },
        () => addMarkers(),
        { timeout: 5000 }
      );
    } else {
      addMarkers();
    }
  }, [posts, onSelectPost]);

  return (
    <div className="fixed inset-0 z-[70] bg-day-bg flex flex-col">
      <header className="p-6 pb-4 flex items-center justify-between shrink-0 border-b border-theme-primary/10 bg-white">
        <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full bg-stone-50 text-theme-accent flex items-center justify-center">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="text-center">
          <h2 className="text-xl font-display font-black italic text-theme-primary">Species Map</h2>
          <p className="catalog-label text-[9px] text-theme-primary/40">{posts.length} public observation{posts.length === 1 ? '' : 's'} mapped{nearestCount > 0 ? ` · ${nearestCount} within 50km` : ''}</p>
        </div>
        <div className="w-10 h-10" />
      </header>

      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-day-bg">
            <p className="text-xs font-bold uppercase tracking-widest text-theme-primary/40">Loading observations...</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-day-bg text-center px-8">
            <span className="material-symbols-outlined text-3xl text-red-400">cloud_off</span>
            <p className="text-xs font-bold uppercase tracking-widest text-stone-500">{error}</p>
          </div>
        )}
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default SpeciesMap;
