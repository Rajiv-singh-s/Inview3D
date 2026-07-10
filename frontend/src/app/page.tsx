import Link from 'next/link';

const STEPS = [
  { n: 1, title: 'Upload a walkthrough', body: 'Any common video format — we validate and transcode automatically.' },
  { n: 2, title: 'Automatic reconstruction', body: 'COLMAP + OpenMVS turn frames into a textured 3D mesh.' },
  { n: 3, title: 'Explore in the browser', body: 'Orbit, zoom and pan through the reconstructed interior.' },
];

export default function LandingPage() {
  return (
    <div className="space-y-20">
      <section className="mx-auto max-w-3xl text-center">
        <p className="mb-4 inline-block rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400">
          Phase 1 MVP · No AI, pure photogrammetry
        </p>
        <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Turn an indoor walkthrough video into an interactive 3D space
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
          InView3D reconstructs the interior of any building from a single walkthrough video —
          then lets you explore it in the browser, like Street View for indoor spaces.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/upload" className="btn-primary">
            Upload a video
          </Link>
          <Link href="/projects" className="btn-ghost">
            View projects
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-6">
            <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-brand-500/20 font-semibold text-brand-400">
              {s.n}
            </div>
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="card p-8">
        <h2 className="text-xl font-semibold">How it works under the hood</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Frames are extracted with FFmpeg, camera poses recovered via COLMAP structure-from-motion,
          a dense point cloud and textured mesh built with OpenMVS, and the result exported as an
          optimized GLB model rendered with three.js / React Three Fiber.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300">
          {['FFmpeg', 'COLMAP', 'OpenMVS', 'GLB', 'three.js', 'React Three Fiber'].map((t) => (
            <span key={t} className="rounded-full border border-slate-700 px-3 py-1">
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
