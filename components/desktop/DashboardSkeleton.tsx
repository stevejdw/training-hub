'use client';

/** Sized to the real dashboard grid so the switch to live content doesn't
 *  shift layout. HomeContent used to return null until mounted, which meant
 *  a blank frame on every load — the page looked broken for a beat. */
export default function DashboardSkeleton({ desktop }: { desktop: boolean }) {
  if (!desktop) {
    return (
      <div className="h-full overflow-hidden">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          <div className="h-28 bg-raised rounded-2xl animate-pulse" />
          <div className="h-16 bg-raised rounded-2xl animate-pulse" />
          <div className="h-40 bg-raised rounded-2xl animate-pulse" />
          <div className="h-24 bg-raised rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full px-6 py-5">
      <div className="h-8 w-40 bg-raised rounded-lg animate-pulse mb-4" />
      <div className="h-[calc(100%-3rem)] grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col gap-4 min-h-0">
          <div className="flex-[3] bg-raised rounded-xl animate-pulse" />
          <div className="flex-[2] bg-raised rounded-xl animate-pulse" />
        </div>
        <div className="col-span-4 space-y-4 min-h-0">
          <div className="grid grid-cols-3 gap-2">
            <div className="h-20 bg-raised rounded-xl animate-pulse" />
            <div className="h-20 bg-raised rounded-xl animate-pulse" />
            <div className="h-20 bg-raised rounded-xl animate-pulse" />
          </div>
          <div className="h-48 bg-raised rounded-xl animate-pulse" />
          <div className="h-40 bg-raised rounded-xl animate-pulse" />
        </div>
      </div>
    </div>
  );
}
