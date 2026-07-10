import type { VideoInfo } from '@/types';
import { formatBitrate, formatBytes, formatDuration } from '@/lib/format';

/** Renders the FFprobe-extracted video metadata as a definition grid. */
export function VideoInfoPanel({ info }: { info: VideoInfo }) {
  const rows: Array<[string, string]> = [
    ['Filename', info.filename],
    ['Size', formatBytes(info.sizeBytes)],
    ['Duration', formatDuration(info.durationSeconds)],
    ['Resolution', info.width && info.height ? `${info.width} × ${info.height}` : '—'],
    ['FPS', info.fps ? String(info.fps) : '—'],
    ['Codec', info.videoCodec || '—'],
    ['Bitrate', formatBitrate(info.bitrate)],
    ['Container', info.container || '—'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="truncate font-medium text-slate-100" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
