import ProfileEditor from '@/components/ProfileEditor';

export const metadata = { title: 'Settings | Training Hub' };

/** For now Settings shares the ProfileEditor surface (theme, timezone,
 *  zones live there). When we split out a dedicated app-settings panel
 *  this page becomes its own component. */
export default function SettingsPage() {
  return (
    <div className="h-full">
      <ProfileEditor initialTab="profile" />
    </div>
  );
}
