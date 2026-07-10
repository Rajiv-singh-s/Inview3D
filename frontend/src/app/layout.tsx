import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';

export const metadata: Metadata = {
  title: 'InView3D — Video to interactive 3D',
  description:
    'Turn an indoor walkthrough video into an explorable browser-based 3D environment using classical photogrammetry.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <div className="flex min-h-screen flex-col">
            <header className="border-b border-slate-800/80">
              <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                <Link href="/" className="flex items-center gap-2 font-semibold">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-white">
                    3D
                  </span>
                  <span>InView3D</span>
                </Link>
                <div className="flex items-center gap-6 text-sm text-slate-300">
                  <Link href="/upload" className="hover:text-white">
                    Upload
                  </Link>
                  <Link href="/projects" className="hover:text-white">
                    Projects
                  </Link>
                </div>
              </nav>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
            <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
              InView3D · Phase 1 MVP · Classical photogrammetry (COLMAP + OpenMVS)
            </footer>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
