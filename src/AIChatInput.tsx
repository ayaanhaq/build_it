import { useState } from "react";
import { Plus, ArrowUp, Mic } from "lucide-react";

interface AIChatInputProps {
  onSendMessage?: (message: string) => void;
  placeholder?: string;
  initialValue?: string;
}

export default function AIChatInput({
  onSendMessage,
  placeholder = "Message anything...",
}: AIChatInputProps) {
  const [message, setMessage] = useState("");

  const handleSend = () => {
    if (!message.trim()) return;
    console.log("Message sent:", message);
    if (onSendMessage) {
      onSendMessage(message);
    }
    setMessage("");
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-3">
      <div className="bg-[#1e1e1e] border border-white/10 rounded-3xl p-3 shadow-xl focus-within:border-white/25 transition-all">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="w-full bg-transparent text-white placeholder-gray-500 outline-none resize-none px-3 py-2 text-base"
        />

        <div className="flex items-center justify-between px-1 pt-2">
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-full text-gray-400 hover:bg-white/10 hover:text-white transition">
              <Plus size={20} />
            </button>
            <span className="text-xs text-gray-500">
              Ask anything
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 rounded-full text-gray-400 hover:bg-white/10 transition">
              <Mic size={19} />
            </button>
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className="p-3 rounded-full bg-white text-black hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
