'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useUploadStore } from '@/store/upload-store';
import { formatBytes } from '@/lib/format';

/**
 * Drag & drop / browse video selector. Accepts any video/* file — real
 * validation happens server-side via FFprobe (never trust the extension).
 */
export function Dropzone() {
  const { file, phase, setFile } = useUploadStore();

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) setFile(accepted[0]);
    },
    [setFile],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    maxFiles: 1,
    multiple: false,
    noClick: true,
    disabled: phase === 'uploading',
  });

  return (
    <div
      {...getRootProps()}
      className={`card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center transition
        ${isDragActive ? 'border-brand-500 bg-brand-500/5' : 'border-dashed'}`}
    >
      <input {...getInputProps()} />
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-800 text-2xl">🎥</div>
      {file ? (
        <div>
          <p className="font-medium">{file.name}</p>
          <p className="text-sm text-slate-400">{formatBytes(file.size)}</p>
        </div>
      ) : (
        <div>
          <p className="font-medium">Drag & drop a walkthrough video</p>
          <p className="text-sm text-slate-400">MP4, MOV, AVI, MKV, WEBM and more</p>
        </div>
      )}
      <button
        type="button"
        onClick={open}
        disabled={phase === 'uploading'}
        className="btn-ghost mt-2"
      >
        Browse files
      </button>
    </div>
  );
}
