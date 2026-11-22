import React from "react";
import { ChatSession } from "./types";
import {
  MessageSquare,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Box,
  Trash2,
  Clock,
  Sparkles,
} from "lucide-react";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  isOpen,
  onToggle,
}) => {
  if (!isOpen) {
    return (
      <div className="fixed top-4 left-4 z-40">
        <button
          onClick={onToggle}
          title="Open Sidebar"
          className="p-2.5 rounded-2xl bg-[#18191c]/90 backdrop-blur-md border border-white/15 text-gray-400 hover:text-white hover:bg-white/10 transition shadow-xl"
        >
          <PanelLeftOpen size={19} />
        </button>
      </div>
    );
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-72 bg-[#121316]/95 backdrop-blur-xl border-r border-white/10 flex flex-col justify-between p-3.5 shadow-2xl transition-all">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between px-2 py-1.5 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Box size={16} />
            </div>
            <span className="font-bold text-xs tracking-wider uppercase text-white font-mono">
              Builders Archive
            </span>
          </div>

          <button
            onClick={onToggle}
            title="Collapse Sidebar"
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-medium text-xs transition shadow-sm group mb-4"
        >
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-amber-400 group-hover:rotate-90 transition duration-200" />
            <span>New Chat</span>
          </div>
          <span className="text-[10px] font-mono text-gray-400 bg-white/10 px-1.5 py-0.5 rounded-md">
            ⌘K
          </span>
        </button>

        {/* Section Title */}
        <div className="px-2 mb-2 flex items-center justify-between text-[11px] font-mono uppercase text-gray-500 tracking-wider">
          <span>Recent Chats</span>
          <span>{sessions.length}</span>
        </div>

        {/* Sessions List */}
        <div className="space-y-1.5 max-h-[calc(100vh-250px)] overflow-y-auto pr-1">
          {sessions.length === 0 ? (
            <div className="text-center py-8 px-3 border border-dashed border-white/10 rounded-2xl text-gray-500 text-xs">
              <MessageSquare size={20} className="mx-auto mb-2 opacity-40" />
              <p>No chat history yet.</p>
              <p className="text-[10px] text-gray-600 mt-1">Start by asking for a build!</p>
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition text-xs ${
                    isActive
                      ? "bg-amber-500/15 border border-amber-500/30 text-white font-medium shadow-sm"
                      : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <MessageSquare
                      size={14}
                      className={isActive ? "text-amber-400 flex-shrink-0" : "text-gray-500 flex-shrink-0"}
                    />
                    <div className="truncate">
                      <p className="truncate font-medium">{session.title}</p>
                      <p className="text-[10px] text-gray-500 font-mono flex items-center gap-1 mt-0.5">
                        <Clock size={10} />
                        {session.timestamp}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    title="Delete Chat"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/10 transition"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-3 border-t border-white/10 px-2 flex items-center justify-between text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          3D Engine Active
        </span>
        <span className="font-mono text-[10px] text-gray-600">v2.0</span>
      </div>
    </aside>
  );
};
