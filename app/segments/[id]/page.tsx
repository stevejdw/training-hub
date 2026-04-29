import SegmentDetail from '@/components/SegmentDetail';

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SegmentDetail id={id} />;
}
