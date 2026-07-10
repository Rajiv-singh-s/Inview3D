import Link from 'next/link';

const STEPS = [
  { n: 1, title: 'Guided capture', body: 'Stand in one spot, slowly rotate your phone. Guide circles show exactly where to aim.' },
  { n: 2, title: 'Automatic stitching', body: 'OpenCV aligns all your photos and blends them into a seamless 360\u00b0 equirectangular panorama.' },
  { n: 3, title: 'Explore in the browser', body: 'Drag to look around, pinch or scroll to zoom. Full 360\u00b0 horizontal and vertical coverage.' },
];

export default function LandingPage() {
  return (
    <div className="space-y-20">
      <section className="mx-auto max-w-3xl text-center">
        <p className="mb-4 inline-block rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400">
          Classical CV · No AI · Runs on any phone
        </p>
        <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Capture an interactive 360\u00b0 photosphere from your phone
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
          InView3D guides you through a spherical photo capture and stitches your shots
          into an explorable panorama \u2014 like Street View, but for any space you choose.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/capture" className="btn-primary">
            Start capture
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
          Device orientation sensors guide you to each capture position. Photos are matched with
          SIFT features, rotations are refined with bundle adjustment, and the result is warped to
          a canonical 2:1 equirectangular canvas and rendered with three.js inside a sphere.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300">
          {['OpenCV', 'SIFT', 'Bundle Adjustment', 'Equirectangular', 'three.js', 'React Three Fiber'].map((t) => (
            <span key={t} className="rounded-full border border-slate-700 px-3 py-1">
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
