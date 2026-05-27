'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

const STORAGE_KEY = 'training_hub_chats';
const PROMPTS_KEY = 'training_hub_prompts';
const MAX_STORED = 50;

const DEFAULT_QUESTIONS = [
  {
    label: 'Feedback on the last ride',
    prompt: 'Coach feedback on my last ride.',
  },
];

/** Builds the activity-specific feedback prompt used by the
 *  "Get Coach feedback" button on individual activity pages. The
 *  full insight-focused behaviour lives in the system prompt; we
 *  keep the user message short so the chat bubble stays clean. */
export function activityFeedbackPrompt(activityId: string | number, activityName?: string): string {
  const ref = activityName ? `"${activityName}" (id ${activityId})` : `activity id ${activityId}`;
  return `Coach feedback on ${ref}.`;
}

function loadPrompts(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(PROMPTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function loadSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_STORED)));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sessionTitle(messages: Message[]): string {
  const first = messages.find(m => m.role === 'user')?.content ?? 'New chat';
  return first.length > 50 ? first.slice(0, 50) + '…' : first;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-AU', { weekday: 'short' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold mr-2 flex-shrink-0 mt-1">
          C
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-orange-500 text-white rounded-tr-sm'
            : 'bg-gray-800 text-gray-100 rounded-tl-sm'
        }`}
      >
        {message.content.split('\n').map((line, i) => {
          const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          const withCode = formatted.replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-1 rounded text-xs">$1</code>');
          return (
            <p
              key={i}
              className={line.startsWith('- ') || line.startsWith('• ') ? 'ml-4' : ''}
              dangerouslySetInnerHTML={{ __html: withCode }}
            />
          );
        })}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-bold ml-2 flex-shrink-0 mt-1">
          S
        </div>
      )}
    </div>
  );
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const sentInitialRef = useRef(false);

  // Load sessions and custom prompts from localStorage on mount
  useEffect(() => {
    setSessions(loadSessions());
    setCustomPrompts(loadPrompts());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const persistSession = useCallback((id: string, msgs: Message[]) => {
    setSessions(prev => {
      const existing = prev.find(s => s.id === id);
      const updated: ChatSession = {
        id,
        title: sessionTitle(msgs),
        createdAt: existing?.createdAt ?? Date.now(),
        messages: msgs,
      };
      const rest = prev.filter(s => s.id !== id);
      const next = [updated, ...rest];
      saveSessions(next);
      return next;
    });
  }, []);

  function startNewChat() {
    setMessages([]);
    setCurrentId(null);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function loadSession(session: ChatSession) {
    setMessages(session.messages);
    setCurrentId(session.id);
    setSidebarOpen(false);
    setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  }

  function deleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (currentId === id) {
      setMessages([]);
      setCurrentId(null);
    }
  }

  function openEdit(label: string, currentPrompt: string) {
    setEditingLabel(label);
    setEditDraft(currentPrompt);
  }

  function saveEdit() {
    if (!editingLabel) return;
    const next = { ...customPrompts, [editingLabel]: editDraft };
    setCustomPrompts(next);
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(next));
    setEditingLabel(null);
  }

  function resetPrompt(label: string, defaultPrompt: string) {
    const next = { ...customPrompts };
    delete next[label];
    setCustomPrompts(next);
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(next));
    setEditDraft(defaultPrompt);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const id = currentId ?? newId();
    if (!currentId) setCurrentId(id);

    const userMessage: Message = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error('Request failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: full };
          return updated;
        });
      }

      const finalMessages = [...newMessages, { role: 'assistant' as const, content: full }];
      persistSession(id, finalMessages);
    } catch (err) {
      console.error(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  // Auto-send a prompt passed via ?prompt= (used by the Get Coach
  // Feedback button on activity pages). Fires once per mount.
  useEffect(() => {
    if (sentInitialRef.current) return;
    const initialPrompt = searchParams.get('prompt');
    if (!initialPrompt) return;
    sentInitialRef.current = true;
    // Clear the param so a refresh doesn't re-fire the prompt.
    router.replace('/chat');
    sendMessage(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* Sidebar overlay backdrop — mobile only */}
      {sidebarOpen && (
        <div
          className="md:hidden absolute inset-0 z-10 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — overlay on mobile, persistent on desktop */}
      <div
        className={`absolute md:static left-0 top-0 h-full w-72 md:w-56 flex-shrink-0 bg-gray-900 md:bg-gray-950/50 border-r border-gray-800 z-20 flex flex-col transition-transform duration-200 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 md:py-5 border-b border-gray-800 md:border-b-0 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-300 md:text-[11px] md:uppercase md:tracking-wider md:text-gray-500">
            <span className="md:hidden">Chat history</span>
            <span className="hidden md:inline">Coach AI</span>
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-gray-500 hover:text-white transition-colors p-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-3 py-2 flex-shrink-0">
          <button
            onClick={startNewChat}
            className="w-full text-sm text-left px-3 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New chat
          </button>
        </div>
        <div className="hidden md:block px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          History
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-gray-600 px-2 py-4 text-center">No past chats yet</p>
          )}
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => loadSession(session)}
              className={`group flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                currentId === session.id
                  ? 'bg-gray-700 text-white'
                  : 'hover:bg-gray-800 text-gray-400'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate leading-tight">{session.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{formatDate(session.createdAt)}</p>
              </div>
              <button
                onClick={(e) => deleteSession(e, session.id)}
                className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5 p-1 -m-1 rounded hover:bg-gray-800/60"
                title="Delete chat"
                aria-label="Delete chat"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar with sidebar toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-gray-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-800"
            title="Chat history"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {currentId && (
            <span className="text-sm text-gray-500 truncate">
              {sessions.find(s => s.id === currentId)?.title ?? ''}
            </span>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="text-4xl mb-4">🚴</div>
              <h2 className="text-xl font-semibold text-white mb-2">Training Coach</h2>
              <p className="text-gray-400 text-sm max-w-md mb-8">
                Ask me anything about your training. I have your full history loaded — activities,
                fitness trends, power data, and more.
              </p>
              <div className="grid grid-cols-1 gap-2 w-full max-w-lg">
                {DEFAULT_QUESTIONS.map((q) => {
                  const prompt = customPrompts[q.label] ?? q.prompt;
                  return (
                    <div key={q.label} className="relative group">
                      {editingLabel === q.label ? (
                        <div className="bg-gray-800 border border-orange-500/50 rounded-xl p-3 space-y-2">
                          <p className="text-xs text-gray-400 font-medium">{q.label} — edit prompt</p>
                          <textarea
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={5}
                            className="w-full bg-gray-900 text-sm text-gray-200 rounded-lg p-2 outline-none resize-none border border-gray-700 focus:border-orange-500"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => resetPrompt(q.label, q.prompt)}
                              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors"
                            >
                              Reset to default
                            </button>
                            <button
                              onClick={() => setEditingLabel(null)}
                              className="text-xs text-gray-400 hover:text-white px-3 py-1 rounded-lg bg-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveEdit}
                              className="text-xs text-white px-3 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 transition-colors"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => sendMessage(prompt)}
                            className="w-full text-left text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-orange-500 rounded-xl px-4 py-2.5 transition-colors pr-10"
                          >
                            {q.label}
                            {customPrompts[q.label] && (
                              <span className="ml-2 text-xs text-orange-500/70">customised</span>
                            )}
                          </button>
                          <button
                            onClick={() => openEdit(q.label, prompt)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-white transition-all rounded-lg hover:bg-gray-700"
                            title="Edit prompt"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3.414a2 2 0 01.586-1.414z" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
          )}
          {loading && messages[messages.length - 1]?.content === '' && (
            <div className="flex items-center gap-2 text-gray-500 text-sm ml-10">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
              </div>
              <span>Analysing your training data…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex gap-3 items-end bg-gray-800 rounded-2xl p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your training…"
              rows={1}
              className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm px-2 py-1.5 max-h-32"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 128) + 'px';
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4 text-white rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-600 text-center mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
