import ProfileEditor from '@/components/ProfileEditor';

export const metadata = { title: 'Profile | Training Hub' };

export default function ProfilePage() {
  return (
    <div className="h-[calc(100vh-64px)] overflow-y-auto">
      <ProfileEditor />
    </div>
  );
}
