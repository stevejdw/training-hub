import ChatInterface from '@/components/ChatInterface';

export const metadata = {
  title: 'Training Coach | Training Hub',
};

export default function ChatPage() {
  return (
    <div className="h-[calc(100vh-64px)]">
      <ChatInterface />
    </div>
  );
}
