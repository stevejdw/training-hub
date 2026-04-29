import { Suspense } from 'react';
import ChatInterface from '@/components/ChatInterface';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Coach AI | Training Hub' };

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('chat')} title="Coach AI" />
      <div className="flex-1 min-h-0">
        <Suspense>
          <ChatInterface />
        </Suspense>
      </div>
    </div>
  );
}
