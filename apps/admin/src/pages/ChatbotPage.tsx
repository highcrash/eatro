import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuthStore } from '../store/auth.store';
import AiModelsTab from './chatbot/AiModelsTab';
import CommentsTab from './chatbot/CommentsTab';
import ComplaintsTab from './chatbot/ComplaintsTab';
import ConnectTab from './chatbot/ConnectTab';
import InboxTab from './chatbot/InboxTab';
import KnowledgeTab from './chatbot/KnowledgeTab';
import LeadsTab from './chatbot/LeadsTab';
import ReportsTab from './chatbot/ReportsTab';
import SettingsTab from './chatbot/SettingsTab';

type Tab = 'inbox' | 'comments' | 'complaints' | 'leads' | 'knowledge' | 'connect' | 'ai' | 'settings' | 'reports';
const TABS: Tab[] = ['inbox', 'comments', 'complaints', 'leads', 'knowledge', 'connect', 'ai', 'settings', 'reports'];

export default function ChatbotPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : 'inbox');
  const [openConversation, setOpenConversation] = useState<string | null>(null);
  // Facebook Login sends the owner back with ?tab=connect&fb=ok|pick|error&msg=…
  const [fbResult] = useState({ fb: params.get('fb'), msg: params.get('msg') });
  useEffect(() => {
    if (params.has('fb')) setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    const open = (e: Event) => { setOpenConversation((e as CustomEvent<string>).detail); setTab('inbox'); };
    window.addEventListener('chatbot:open-conversation', open);
    return () => window.removeEventListener('chatbot:open-conversation', open);
  }, []);

  const owner = role === 'OWNER';
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'inbox', label: 'Inbox', show: true },
    { key: 'comments', label: 'Comments', show: true },
    { key: 'complaints', label: 'Complaints', show: true },
    { key: 'leads', label: 'Party Enquiries', show: true },
    { key: 'knowledge', label: 'Knowledge', show: true },
    { key: 'connect', label: 'Connect', show: owner },
    { key: 'ai', label: 'AI Models', show: owner },
    { key: 'settings', label: 'Settings & Test', show: true },
    { key: 'reports', label: 'Reports', show: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Marketing</p>
        <h1 className="font-display text-4xl text-white tracking-wide">CHAT ASSISTANT</h1>
      </div>
      <div className="flex flex-wrap border-b border-[#2A2A2A]">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-xs font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${tab === t.key ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666] hover:text-[#999]'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'inbox' && <InboxTab key={openConversation ?? 'inbox'} initialId={openConversation} />}
      {tab === 'comments' && <CommentsTab />}
      {tab === 'complaints' && <ComplaintsTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'connect' && owner && <ConnectTab result={fbResult} />}
      {tab === 'ai' && owner && <AiModelsTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
