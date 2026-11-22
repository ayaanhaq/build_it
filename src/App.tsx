import React, { useState } from "react";
import AIChatInput from "./AIChatInput";
import { DeskBuilderViewer } from "./DeskBuilderViewer";
import { Sidebar } from "./Sidebar";
import { RightPartsWidget } from "./RightPartsWidget";
import { DESK_BUILD_STEPS } from "./deskData";
import { ChatSession, ChatMessage } from "./types";
import { Sparkles, Bot, User, Box } from "lucide-react";

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([
    {
      id: "session-1",
      title: "Executive Oak Desk",
      preview: "Hey I want to build a desk",
      timestamp: "Today",
      has3DViewer: true,
      currentStep: 1,
      messages: [
        {
          id: "m-user-1",
          sender: "user",
          text: "Hey I want to build a desk",
          timestamp: "Just now",
        },
        {
          id: "m-bot-1",
          sender: "assistant",
          text: "Here is your step-by-step 3D assembly manual for the Modern Solid Oak Desk (1200 × 700 × 750 mm). The parts required for your current step are displayed in the Parts Callout widget on the right. You can click & drag to rotate 360°, scroll/pinch to zoom, and flip through each step like a Lego manual.",
          timestamp: "Just now",
          hasBuildDemo: true,
        },
      ],
    },
  ]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>("session-1");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [rightWidgetOpen, setRightWidgetOpen] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [highlightedPartName, setHighlightedPartName] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const activeStepData = DESK_BUILD_STEPS[currentStep - 1] || DESK_BUILD_STEPS[0];

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    const s = sessions.find((item) => item.id === id);
    if (s && s.currentStep) {
      setCurrentStep(s.currentStep);
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setCurrentStep(1);
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const handleSendMessage = (text: string) => {
    const isDeskQuery = /desk|table|build|workbench/i.test(text);

    const userMsg: ChatMessage = {
      id: "msg-" + Date.now(),
      sender: "user",
      text,
      timestamp: "Just now",
    };

    if (!activeSessionId) {
      // Create new session
      const newSessionId = "session-" + Date.now();
      const newSessionTitle =
        text.length > 26 ? text.substring(0, 26) + "..." : text;

      const newSession: ChatSession = {
        id: newSessionId,
        title: isDeskQuery ? "Modern Solid Oak Desk" : newSessionTitle,
        preview: text,
        timestamp: "Just now",
        has3DViewer: isDeskQuery,
        currentStep: 1,
        messages: [userMsg],
      };

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSessionId);

      setTimeout(() => {
        const botMsg: ChatMessage = {
          id: "bot-" + Date.now(),
          sender: "assistant",
          text: isDeskQuery
            ? "Here is your step-by-step 3D assembly manual for the Modern Solid Oak Desk (1200 × 700 × 750 mm). The parts required for your current step are displayed in the Parts Callout widget on the right. You can rotate, zoom, and inspect every component in 3D."
            : `I received your request: "${text}". I can generate interactive 3D step-by-step instructions. Try asking: "Hey I want to build a desk"!`,
          timestamp: "Just now",
          hasBuildDemo: isDeskQuery,
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === newSessionId
              ? { ...s, messages: [...s.messages, botMsg] }
              : s
          )
        );
      }, 350);
    } else {
      // Append to active session
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, userMsg] }
            : s
        )
      );

      setTimeout(() => {
        const botMsg: ChatMessage = {
          id: "bot-" + Date.now(),
          sender: "assistant",
          text: isDeskQuery
            ? "Updated 3D instruction manual for the Modern Solid Oak Desk. You can navigate the steps and inspect parts on the right."
            : `Understood! Let me know if you want to inspect a specific step, adjust dimensions, or see alternate materials.`,
          timestamp: "Just now",
          hasBuildDemo: isDeskQuery,
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  has3DViewer: s.has3DViewer || isDeskQuery,
                  messages: [...s.messages, botMsg],
                }
              : s
          )
        );
      }, 350);
    }
  };

  const handleTriggerDemo = () => {
    handleSendMessage("Hey I want to build a desk");
  };

  const hasMessages = activeSession && activeSession.messages.length > 0;
  const showRightWidget = hasMessages && activeSession?.has3DViewer;

  return (
    <div className="min-h-screen w-full bg-black text-white flex overflow-x-hidden">
      {/* 1. LEFT SIDEBAR: Keeps track of chats so far */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
      />

      {/* 2. CENTER MAIN WORKSPACE */}
      <main
        className={`flex-1 min-h-screen flex flex-col justify-between p-4 md:p-6 transition-all duration-300 ${
          sidebarOpen ? "md:ml-72" : "ml-0"
        } ${showRightWidget && rightWidgetOpen ? "md:mr-80 lg:mr-88" : "mr-0"}`}
      >
        {!hasMessages ? (
          /* Pristine Landing View when starting a new chat */
          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl mx-auto py-12">
            <div className="flex items-center gap-2 mb-6 text-gray-500 font-mono text-xs uppercase tracking-widest">
              <Box size={16} className="text-amber-500" />
              <span>Builders Archive · 3D Model Generator</span>
            </div>

            <AIChatInput onSendMessage={handleSendMessage} />

            <div className="mt-4 flex items-center justify-center">
              <button
                onClick={handleTriggerDemo}
                className="group flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-400 hover:text-white transition shadow-lg"
              >
                <Sparkles size={14} className="text-amber-400 group-hover:scale-110 transition" />
                <span>
                  Try demo: <strong className="text-white font-medium">"Hey I want to build a desk"</strong>
                </span>
              </button>
            </div>
          </div>
        ) : (
          /* Active Conversation with 3D Desk Model */
          <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col justify-between pb-4">
            {/* Header */}
            <div className="flex items-center justify-between py-2.5 border-b border-white/10 mb-5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-sm tracking-wide text-white">
                  {activeSession.title}
                </span>
              </div>
              <button
                onClick={handleNewChat}
                className="text-xs text-gray-500 hover:text-gray-300 font-mono transition"
              >
                + Start New Chat
              </button>
            </div>

            {/* Messages list */}
            <div className="space-y-6 flex-1 mb-8">
              {activeSession.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3.5 ${
                    msg.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.sender === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 mt-1">
                      <Bot size={18} />
                    </div>
                  )}

                  <div
                    className={`max-w-3xl ${
                      msg.sender === "user"
                        ? "bg-white text-black font-medium rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-md"
                        : "space-y-4 w-full"
                    }`}
                  >
                    {msg.sender === "assistant" && (
                      <div className="bg-[#18191c] border border-white/10 rounded-2xl rounded-tl-sm p-4 text-sm text-gray-200 shadow-md">
                        {msg.text}
                      </div>
                    )}

                    {msg.sender === "user" && msg.text}

                    {/* 3D Lego Instruction Manual Viewer (Parts callout moved to right widget) */}
                    {msg.hasBuildDemo && (
                      <div className="w-full mt-2">
                        <DeskBuilderViewer
                          currentStep={currentStep}
                          onStepChange={(s) => setCurrentStep(s)}
                          showEmbeddedPartsCard={!rightWidgetOpen}
                          highlightedPartName={highlightedPartName}
                          onPartSelected={(name) => setHighlightedPartName(name)}
                        />
                      </div>
                    )}
                  </div>

                  {msg.sender === "user" && (
                    <div className="w-8 h-8 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white flex-shrink-0 mt-1">
                      <User size={18} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Pinned Input at Bottom */}
            <div className="w-full sticky bottom-0 pt-2 bg-gradient-to-t from-black via-black/90 to-transparent">
              <AIChatInput onSendMessage={handleSendMessage} />
            </div>
          </div>
        )}
      </main>

      {/* 3. RIGHT PARTS CALLOUT WIDGET: Appears when a message has been sent */}
      {showRightWidget && (
        <RightPartsWidget
          step={activeStepData}
          currentStep={currentStep}
          totalSteps={DESK_BUILD_STEPS.length}
          isOpen={rightWidgetOpen}
          onToggle={() => setRightWidgetOpen((prev) => !prev)}
          onStepSelect={(step) => setCurrentStep(step)}
          onPartHighlight={(name) => setHighlightedPartName(name)}
          highlightedPartName={highlightedPartName}
        />
      )}
    </div>
  );
}
