'use client';

import { useEffect, useRef } from 'react';

interface Props {
  polyline: string;
  className?: string;
}

export default function ActivityMap({ polyline, className }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    async function init() {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      const polylineDecode = (await import('polyline')).default;

      const coords = polylineDecode.decode(polyline) as [number, number][];
      if (coords.length === 0) return;

      const map = L.map(mapRef.current!, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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
