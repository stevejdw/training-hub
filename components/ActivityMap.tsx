'use client';

import { useEffect, useRef } from 'react';
import { CHART } from '@/lib/chart-theme';

interface Props {
  polyline: string;
  className?: string;
  thumbnail?: boolean;
  /** [lat, lng] to highlight with a marker (chart hover-sync); null hides it. */
  hoverPoint?: [number, number] | null;
}

export default function ActivityMap({ polyline, className, thumbnail, hoverPoint }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const hoverMarkerRef = useRef<unknown>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    async function init() {
      const L = (await import('leaflet')).default;
      leafletRef.current = L;
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
        color: CHART.power,
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
      hoverMarkerRef.current = null;
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [polyline]);

  // Keep tiles valid when the container resizes (desktop split panes).
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      (mapInstanceRef.current as { invalidateSize?: () => void } | null)?.invalidateSize?.();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Hover-sync marker, managed imperatively so the map never re-inits.
  useEffect(() => {
    const map = mapInstanceRef.current as import('leaflet').Map | null;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (hoverPoint) {
      let marker = hoverMarkerRef.current as import('leaflet').CircleMarker | null;
      if (!marker) {
        marker = L.circleMarker(hoverPoint, {
          radius: 7, color: CHART.reference, fillColor: CHART.power, fillOpacity: 1, weight: 2,
        }).addTo(map);
        hoverMarkerRef.current = marker;
      } else {
        marker.setLatLng(hoverPoint);
        if (!map.hasLayer(marker)) marker.addTo(map);
      }
    } else if (hoverMarkerRef.current) {
      const marker = hoverMarkerRef.current as import('leaflet').CircleMarker;
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  }, [hoverPoint]);

  return (
    <div ref={mapRef} className={className ?? 'w-full h-72 rounded-xl overflow-hidden bg-raised'} />
  );
}
