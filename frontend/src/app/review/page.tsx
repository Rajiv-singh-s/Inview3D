'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';
import Image from 'next/image';

export default function ReviewPage() {
  const router = useRouter();
  const capturedFrames = useCaptureStore((s) => s.capturedFrames);
  const frames = Object.values(capturedFrames).sort((a, b) => a.pose.timestamp - b.pose.timestamp);
  
  const [locationName, setLocationName] = useState('Detecting location...');

  useEffect(() => {
    if (frames.length === 0) {
      router.replace('/');
      return;
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const res = await fetch(\`https://nominatim.openstreetmap.org/reverse?format=json&lat=\${position.coords.latitude}&lon=\${position.coords.longitude}\`);
            const data = await res.json();
            
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';
            const country = data.address?.country || '';
            
            if (city && country) {
              setLocationName(\`\${city}, \${country}\`);
            } else {
              setLocationName('Location found');
            }
          } catch (e) {
            setLocationName('Location unavailable');
          }
        },
        () => {
          setLocationName('Location access denied');
        }
      );
    } else {
      setLocationName('Geolocation not supported');
    }
  }, [frames.length, router]);

  if (frames.length === 0) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="px-4 pt-12 pb-6">
          <h1 className="text-xl font-bold text-black mb-4">Source images ({frames.length})</h1>
          <div className="grid grid-cols-2 gap-2">
            {frames.map((frame, i) => (
              <div key={i} className="aspect-[4/3] relative rounded-xl overflow-hidden bg-gray-200">
                <Image 
                  src={frame.thumbnailUrl} 
                  alt={\`Source \${i + 1}\`} 
                  fill 
                  className="object-cover"
                />
              </div>
            ))}
          </div>
          <div className="mt-8">
            <h2 className="text-xl font-bold text-black mb-4">Details</h2>
            <div className="bg-white rounded-2xl p-4 flex items-center justify-between shadow-sm mb-4">
              <div>
                <h3 className="font-semibold text-black">Private</h3>
                <p className="text-sm text-gray-500">If enabled, your asset will be hidden from the explore page.</p>
              </div>
              <div className="w-12 h-7 bg-gray-200 rounded-full relative">
                <div className="absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-3 text-blue-500 font-medium">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg>
              <span>{locationName}</span>
            </div>
            <div className="h-40 bg-blue-100 rounded-2xl relative overflow-hidden flex items-center justify-center border border-gray-200">
              <span className="text-blue-500/50 font-bold text-2xl tracking-widest">MAPS</span>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 flex flex-col gap-3">
        <button 
          onClick={() => router.push('/processing')}
          className="w-full bg-black text-white font-bold py-4 rounded-full text-lg shadow-lg hover:scale-[0.98] transition-transform"
        >
          Stitch and post
        </button>
        <button 
          onClick={() => router.push('/')}
          className="w-full text-gray-500 font-medium py-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
