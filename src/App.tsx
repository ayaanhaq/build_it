import React, { useState } from "react";
import AIChatInput from "./AIChatInput";
import { DeskBuilderViewer } from "./DeskBuilderViewer";
import { Sparkles, Bot, User, Box } from "lucide-react";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  has3DViewer?: boolean;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [showDemo, setShowDemo] = useState<boolean>(false);

  const handleSendMessage = (text: string) => {
    const userMsg: Message = {
      id: "msg-" + Date.now(),
      sender: "user",
      text,
    };

    const isDeskQuery = /desk|table|build|workbench/i.test(text);

    setMessages((prev) => [...prev, userMsg]);

    setTimeout(() => {
      const botMsg: Message = {
        id: "bot-" + Date.now(),
        sender: "assistant",
        text: isDeskQuery
          ? "Here is your step-by-step 3D assembly manual for the Modern Solid Oak Desk (1200 × 700 × 750 mm). Flip through each step like a Lego instruction book to see the exact parts and 3D assembly animations. You can click & drag to rotate 360°, scroll/pinch to zoom, and inspect every component."
          : `I received your request: "${text}". I can generate interactive 3D step-by-step instructions. Try asking: "Hey I want to build a desk"!`,
        has3DViewer: isDeskQuery,
      };

      setMessages((prev) => [...prev, botMsg]);
      if (isDeskQuery) {
        setShowDemo(true);
      }
    }, 400);
  };

  const handleTriggerDemo = () => {
    handleSendMessage("Hey I want to build a desk");
  };

  return (
    <main className="min-h-screen w-full bg-black text-white flex flex-col justify-between p-4 md:p-8">
      {/* If no messages yet, display the pristine centered AIChatInput */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl mx-auto">
          {/* Logo / Badge */}
          <div className="flex items-center gap-2 mb-6 text-gray-500 font-mono text-xs uppercase tracking-widest">
            <Box size={16} className="text-amber-500" />
            <span>Builders Archive · 3D Model Generator</span>
          </div>

          {/* Centered AIChatInput Component */}
          <AIChatInput onSendMessage={handleSendMessage} />

          {/* Suggestion prompt chip */}
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
        /* Conversation view with 3D Lego Manual */
        <div className="flex-1 w-full max-w-5xl mx-auto flex flex-col justify-between pb-4">
          {/* Header */}
          <div className="flex items-center justify-between py-3 border-b border-white/10 mb-6">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold text-sm tracking-wide text-white">
                Builders Archive 3D Assistant
              </span>
            </div>
            <button
              onClick={() => {
                setMessages([]);
                setShowDemo(false);
              }}
              className="text-xs text-gray-500 hover:text-gray-300 font-mono transition"
            >
              Clear Conversation
            </button>
          </div>

          {/* Messages list */}
          <div className="space-y-6 flex-1 mb-8">
            {messages.map((msg) => (
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

                  {/* 3D Lego Instruction Manual Viewer */}
                  {msg.has3DViewer && (
                    <div className="w-full mt-2">
                      <DeskBuilderViewer />
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
  );
}
