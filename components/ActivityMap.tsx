'use client';

import { useEffect, useRef } from 'react';

interface Props {
  polyline: string;
  className?: string;
  thumbnail?: boolean;
}

export default function ActivityMap({ polyline, className, thumbnail }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    async function init() {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      const polylineDecode = (await import('polyline')).default;

      if (cancelled || !mapRef.current) return;

      const coords = polylineDecode.decode(polyline) as [number, number][];
      if (coords.length === 0) return;

      // Clear any stale Leaflet ID left on the DOM element from a prior
      // render cycle (React StrictMode double-invokes effects) to prevent
      // "Map container is already initialized" errors.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (mapRef.current as any)._leaflet_id;

      const map = L.map(mapRef.current!, {
        zoomControl: !thumbnail,
        attributionControl: false,
        dragging: !thumbnail,
        scrollWheelZoom: !thumbnail,
        doubleClickZoom: !thumbnail,
        touchZoom: !thumbnail,
        keyboard: !thumbnail,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      const line = L.polyline(coords, {
        color: '#f97316',
        weight: 3,
        opacity: 0.9,
      }).addTo(map);

      // Start marker
      L.circleMarker(coords[0], {
        radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2,
      }).addTo(map);

      // End marker
      L.circleMarker(coords[coords.length - 1], {
        radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2,
      }).addTo(map);

      map.fitBounds(line.getBounds(), { padding: [20, 20] });
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [polyline]);

  return (
    <div ref={mapRef} className={className ?? 'w-full h-72 rounded-xl overflow-hidden bg-gray-800'} />
  );
}
