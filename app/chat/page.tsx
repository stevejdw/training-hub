import { Suspense } from 'react';
import ChatInterface from '@/components/ChatInterface';

export const metadata = {
  title: 'Training Coach | Training Hub',
};

export default function ChatPage() {
  return (
    <div className="h-full">
      <Suspense>
        <ChatInterface />
      </Suspense>
    </div>
  );
}
