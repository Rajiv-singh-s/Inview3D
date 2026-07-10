'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { VideoInfoPanel } from '@/components/ui/VideoInfoPanel';
import { formatBytes } from '@/lib/format';

// Both viewers need WebGL — render client-side only.
const ModelViewer = dynamic(
  () => import('@/components/viewer/ModelViewer').then((m) => m.ModelViewer),
  { ssr: false, loading: () => <ViewerSkeleton /> },
);
const PhotosphereViewer = dynamic(
  () => import('@/components/viewer/PhotosphereViewer').then((m) => m.PhotosphereViewer),
  { ssr: false, loading: () => <ViewerSkeleton /> },
);

function ViewerSkeleton() {
  return (
    <div className="grid h-[70vh] w-full place-items-center rounded-2xl border border-slate-800 bg-slate-900">
      <p className="text-slate-400">Initializing viewer…</p>
    </div>
  );
}

export default function ViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['viewer', id],
    queryFn: () => api.getViewerMetadata(id),
  });

  if (isLoading) return <ViewerSkeleton />;

  if (isError || !data) {
    return (
      <div className="card p-6">
        <p className="text-red-300">This project isn&apos;t ready yet.</p>
        <p className="mt-1 text-sm text-slate-400">{(error as Error)?.message}</p>
        <div className="mt-4 flex gap-3">
          <Link href={`/processing/${id}`} className="btn-ghost">
            Check processing status
          </Link>
          <Link href="/projects" className="btn-ghost">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const isPanorama = data.kind === 'panorama';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{data.originalName}</h1>
          <p className="text-sm text-slate-400">
            {isPanorama
              ? `Photosphere · ${data.photoCount ?? '?'} photos · ${formatBytes(data.panoramaSizeBytes)}`
              : `Reconstructed mesh · ${formatBytes(data.glbSizeBytes)} GLB`}
          </p>
        </div>
        <div className="flex gap-3">
          <a
            href={isPanorama ? api.panoramaUrl(id) : api.modelUrl(id)}
            download
            className="btn-ghost"
          >
            {isPanorama ? 'Download panorama' : 'Download GLB'}
          </a>
          <Link href={isPanorama ? '/capture' : '/upload'} className="btn-primary">
            New capture
          </Link>
        </div>
      </div>

      {isPanorama ? (
        <PhotosphereViewer url={api.panoramaUrl(id)} />
      ) : (
        <>
          <ModelViewer url={api.modelUrl(id)} />
          <p className="text-center text-xs text-slate-500">
            Drag to orbit · Scroll to zoom · Right-click drag to pan
          </p>
        </>
      )}

      {!isPanorama && data.videoInfo && (
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Source video</h2>
          <VideoInfoPanel info={data.videoInfo} />
        </div>
      )}
    </div>
  );
}
