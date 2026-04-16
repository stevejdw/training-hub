import ProfileEditor from '@/components/ProfileEditor';

export const metadata = { title: 'Profile | Training Hub' };

export default function ProfilePage() {
  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <ProfileEditor />
    </div>
  );
}
