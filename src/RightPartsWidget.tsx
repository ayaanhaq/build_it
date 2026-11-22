import React from "react";
import { BuildStep } from "./types";
import {
  Layers,
  Wrench,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

interface RightPartsWidgetProps {
  step: BuildStep;
  currentStep: number;
  totalSteps: number;
  isOpen: boolean;
  onToggle: () => void;
  onStepSelect?: (step: number) => void;
  onPartHighlight?: (partName: string | null) => void;
  highlightedPartName?: string | null;
}

export const RightPartsWidget: React.FC<RightPartsWidgetProps> = ({
  step,
  currentStep,
  totalSteps,
  isOpen,
  onToggle,
  onStepSelect,
  onPartHighlight,
  highlightedPartName,
}) => {
  if (!isOpen) {
    return (
      <div className="fixed top-4 right-4 z-40">
        <button
          onClick={onToggle}
          title="Open Parts Callout"
          className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#18191c]/90 backdrop-blur-md border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 transition shadow-xl text-xs font-semibold"
        >
          <Layers size={16} className="text-amber-400" />
          <span>Parts ({step.parts.length})</span>
          <PanelRightOpen size={16} />
        </button>
      </div>
    );
  }

  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-80 md:w-88 bg-[#121316]/95 backdrop-blur-xl border-l border-white/10 flex flex-col justify-between p-4 shadow-2xl transition-all">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Layers size={16} />
            </div>
            <div>
              <span className="font-bold text-xs tracking-wider uppercase text-white font-mono block">
                Parts Callout
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                Bill of Materials
              </span>
            </div>
          </div>

          <button
            onClick={onToggle}
            title="Collapse Parts Widget"
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <PanelRightClose size={18} />
          </button>
        </div>

        {/* Active Step Status Box */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="bg-amber-500 text-black font-extrabold text-[11px] px-2.5 py-0.5 rounded-md tracking-wider uppercase shadow-sm">
              STEP {step.stepNumber}
            </span>
            <span className="text-xs font-mono text-gray-400">
              {progressPercent}% Complete
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <h4 className="text-xs font-bold text-white truncate">
            {step.title}
          </h4>
          <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5 leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Required Components List */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase text-gray-400 tracking-wider px-1">
            <span>Required for Step {step.stepNumber}</span>
            <span>{step.parts.length} Items</span>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-390px)] overflow-y-auto pr-1">
            {step.parts.map((part) => {
              const isSelected =
                highlightedPartName &&
                part.name.toLowerCase().includes(highlightedPartName.toLowerCase());

              return (
                <div
                  key={part.id}
                  onClick={() => onPartHighlight && onPartHighlight(isSelected ? null : part.name)}
                  className={`flex items-center justify-between border rounded-2xl px-3 py-2.5 cursor-pointer transition ${
                    isSelected
                      ? "bg-amber-500/20 border-amber-400/50 shadow-md scale-[1.02]"
                      : "bg-white/5 hover:bg-white/10 border-white/5"
                  }`}
                  title="Click to locate in 3D viewport"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className="flex-shrink-0 bg-white/15 text-white font-mono font-bold text-xs px-2 py-0.5 rounded-md border border-white/10">
                      {part.qty}
                    </span>

                    <div className="truncate">
                      <p className="text-xs font-semibold text-white truncate">
                        {part.name}
                      </p>
                      <p className="text-[10px] text-gray-400 font-mono truncate">
                        {part.dimensions}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/30 shadow-sm"
                      style={{ backgroundColor: part.color }}
                      title={`${part.material} (${part.color})`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pro Tip Callout Box */}
        {step.proTip && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3 flex items-start gap-2.5 text-gray-300">
            <Wrench size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-[11px] leading-tight">
              <span className="text-amber-400 font-semibold block mb-0.5">Assembly Tip</span>
              <p className="text-gray-300">{step.proTip}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer / Step Indicators */}
      <div className="pt-3 border-t border-white/10">
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest block mb-2 text-center">
          Jump to Step
        </span>
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((num) => {
            const isCur = num === currentStep;
            const isDone = num < currentStep;
            return (
              <button
                key={num}
                onClick={() => onStepSelect && onStepSelect(num)}
                className={`h-7 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center ${
                  isCur
                    ? "bg-amber-500 text-black font-extrabold shadow-md scale-105"
                    : isDone
                    ? "bg-white/15 text-white hover:bg-white/25"
                    : "bg-white/5 text-gray-500 hover:bg-white/10"
                }`}
              >
                {num}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
