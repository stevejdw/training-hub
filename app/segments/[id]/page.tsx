import SegmentDetail from '@/components/SegmentDetail';
import DashboardSidebar from '@/components/DashboardSidebar';

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="h-full flex flex-col md:flex-row">
      <DashboardSidebar activeTab="activities" />
      <div className="flex-1 overflow-hidden min-w-0">
        <SegmentDetail id={id} />
      </div>
    </div>
  );
}
