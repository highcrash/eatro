import { useState } from 'react';

import { useAuthStore } from '../store/auth.store';
import AiModelsTab from './chatbot/AiModelsTab';
import InboxTab from './chatbot/InboxTab';
import KnowledgeTab from './chatbot/KnowledgeTab';
import LeadsTab from './chatbot/LeadsTab';
import ReportsTab from './chatbot/ReportsTab';
import SettingsTab from './chatbot/SettingsTab';

type Tab = 'inbox' | 'leads' | 'knowledge' | 'ai' | 'settings' | 'reports';

export default function ChatbotPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [tab, setTab] = useState<Tab>('inbox');
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'inbox', label: 'Inbox', show: true },
    { key: 'leads', label: 'Party Enquiries', show: true },
    { key: 'knowledge', label: 'Knowledge', show: true },
    { key: 'ai', label: 'AI Models', show: role === 'OWNER' },
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
      {tab === 'inbox' && <InboxTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'ai' && role === 'OWNER' && <AiModelsTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
