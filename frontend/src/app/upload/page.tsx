'use client';

import { useRouter } from 'next/navigation';
import { Dropzone } from '@/components/upload/Dropzone';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useUploadStore } from '@/store/upload-store';
import { api, ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';

export default function UploadPage() {
  const router = useRouter();
  const { file, phase, progress, error, start, setProgress, succeed, fail, reset } =
    useUploadStore();

  const startUpload = async () => {
    if (!file) return;
    const controller = new AbortController();
    start(controller);
    try {
      const res = await api.uploadVideo(file, setProgress, controller.signal);
      succeed(res);
      // Processing begins automatically on the backend — go watch it.
      router.push(`/processing/${res.id}`);
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Unexpected upload error');
    }
  };

  const cancel = () => reset();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Upload a walkthrough video</h1>
        <p className="mt-2 text-slate-400">
          The backend validates the file with FFprobe, transcodes it if needed, and starts
          reconstruction automatically.
        </p>
      </div>

      <Dropzone />

      {phase === 'uploading' && (
        <div className="card space-y-3 p-6">
          <div className="flex items-center justify-between text-sm">
            <span>Uploading {file?.name}</span>
            <span className="tabular-nums text-slate-400">{progress}%</span>
          </div>
          <ProgressBar value={progress} />
          <button onClick={cancel} className="btn-ghost">
            Cancel upload
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="card border-red-500/40 bg-red-500/5 p-6">
          <p className="font-medium text-red-300">Upload failed</p>
          <p className="mt-1 text-sm text-red-200/80">{error}</p>
          <div className="mt-4 flex gap-3">
            <button onClick={startUpload} className="btn-primary">
              Retry
            </button>
            <button onClick={cancel} className="btn-ghost">
              Choose another file
            </button>
          </div>
        </div>
      )}

      {file && phase === 'idle' && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Ready to upload · {formatBytes(file.size)}
          </p>
          <div className="flex gap-3">
            <button onClick={cancel} className="btn-ghost">
              Clear
            </button>
            <button onClick={startUpload} className="btn-primary">
              Start reconstruction
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
