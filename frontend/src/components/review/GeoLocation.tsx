'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const GeoLocationMap = dynamic(() => import('./GeoLocationMap'), { 
  ssr: false,
  loading: () => <div className="w-full h-48 bg-white/5 animate-pulse rounded-xl flex items-center justify-center text-slate-400">Loading map...</div>
});

/**
 * State for geolocation
 */
interface GeoState {
  loading: boolean;
  error: string | null;
  lat: number | null;
  lng: number | null;
  locationName: string | null;
}

/**
 * GeoLocation Component
 * Uses HTML5 Geolocation to get current coordinates, Nominatim API for reverse geocoding,
 * and react-leaflet to render the location on a map.
 * Designed with glassmorphism and dark mode in mind.
 */
export const GeoLocation: React.FC = () => {
  const [geoState, setGeoState] = useState<GeoState>({
    loading: true,
    error: null,
    lat: null,
    lng: null,
    locationName: null,
  });

  useEffect(() => {
    let mounted = true;

    if (!('geolocation' in navigator)) {
      setGeoState(s => ({ ...s, loading: false, error: 'Geolocation is not supported by your browser.' }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
          // Fetch reverse geocoding from Nominatim
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
          if (!response.ok) throw new Error('Failed to fetch location data.');
          
          const data = await response.json();
          const locationName = data.display_name || 'Unknown location';
          
          if (mounted) {
            setGeoState({
              loading: false,
              error: null,
              lat,
              lng,
              locationName
            });
          }
        } catch (err) {
          if (mounted) {
            setGeoState({
              loading: false,
              error: 'Failed to retrieve location details.',
              lat,
              lng,
              locationName: null,
            });
          }
        }
      },
      (error) => {
        let errorMsg = 'Failed to get location.';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Location permission denied.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = 'Location information is unavailable.';
        } else if (error.code === error.TIMEOUT) {
          errorMsg = 'The request to get user location timed out.';
        }

        if (mounted) {
          setGeoState(s => ({ ...s, loading: false, error: errorMsg }));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="p-5 rounded-xl bg-slate-900/40 border border-white/10 backdrop-blur-md text-slate-100 flex flex-col space-y-4 shadow-xl">
      <h3 className="text-lg font-semibold text-white">Capture Location</h3>
      
      {geoState.loading && (
        <div className="flex flex-col items-center space-y-3 py-8">
          <div className="w-8 h-8 border-4 border-slate-600 border-t-white rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400">Acquiring location...</p>
        </div>
      )}

      {geoState.error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-200 text-sm">
          {geoState.error}
        </div>
      )}

      {!geoState.loading && !geoState.error && geoState.lat !== null && geoState.lng !== null && (
        <div className="flex flex-col space-y-3">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-slate-100">Coordinates: </span> 
            <span className="font-mono">{geoState.lat.toFixed(4)}, {geoState.lng.toFixed(4)}</span>
          </div>
          
          {geoState.locationName && (
            <div className="text-sm text-slate-300">
              <span className="font-semibold text-slate-100">Address: </span> 
              <span className="leading-relaxed">{geoState.locationName}</span>
            </div>
          )}

          <div className="h-64 w-full rounded-xl overflow-hidden border border-white/10 relative shadow-inner mt-2">
            <GeoLocationMap 
              lat={geoState.lat} 
              lng={geoState.lng} 
              popupText={geoState.locationName || 'You are here'} 
            />
          </div>
        </div>
      )}
    </div>
  );
};
