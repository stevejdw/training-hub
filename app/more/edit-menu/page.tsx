import Link from 'next/link';

export const metadata = { title: 'Edit Menu Bar | Training Hub' };

export default function EditMenuPage() {
  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/more" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
            ← More
          </Link>
        </div>
        <h1 className="text-xl md:text-2xl font-bold text-white">Edit Menu Bar</h1>
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm text-gray-300">Customisable bottom-nav coming soon.</p>
          <p className="text-xs text-gray-500">For now the bar shows Home, Activities, Performance, More.<br />Home is always pinned as the landing page.</p>
        </div>
      </div>
    </div>
  );
}
