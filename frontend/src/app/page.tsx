import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-12 max-w-2xl space-y-6">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
          Capture the world in <span className="text-brand-500">3DGS</span>.
        </h1>
        <p className="text-lg text-slate-400">
          InView3D guides you through capturing 16 perfectly aligned spherical photos. Our cloud GPU pipeline then uses Gaussian Splatting to reconstruct a photorealistic, fully interactive 6-DOF digital twin in minutes.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/capture"
          className="btn btn-primary px-8 py-4 text-lg font-semibold shadow-xl shadow-brand-500/20"
        >
          Start 3D Capture
        </Link>
        <Link href="/projects" className="btn btn-ghost px-8 py-4 text-lg font-semibold">
          View Projects
        </Link>
      </div>
    </div>
  );
}
