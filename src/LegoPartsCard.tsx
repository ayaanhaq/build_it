import React from "react";
import { BuildStep } from "./types";
import { Layers, Box, Wrench, CheckCircle } from "lucide-react";

interface LegoPartsCardProps {
  step: BuildStep;
  currentStepIndex: number;
  totalSteps: number;
}

export const LegoPartsCard: React.FC<LegoPartsCardProps> = ({
  step,
  currentStepIndex,
  totalSteps,
}) => {
  return (
    <div className="absolute top-4 left-4 z-20 max-w-sm w-full pointer-events-auto">
      <div className="bg-[#18191c]/90 backdrop-blur-md border border-white/15 rounded-2xl p-4 shadow-2xl text-white transition-all">
        {/* Lego-style Step Tag */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center bg-amber-500 text-black font-extrabold text-xs px-2.5 py-1 rounded-md tracking-wider uppercase shadow-sm">
              STEP {step.stepNumber}
            </span>
            <span className="text-xs text-gray-400 font-medium">
              of {totalSteps}
            </span>
          </div>
          <span className="text-[11px] font-mono tracking-widest text-amber-400/90 uppercase flex items-center gap-1">
            <Layers size={13} />
            PARTS CALLOUT
          </span>
        </div>

        {/* Parts Required List */}
        <div className="mt-3 space-y-2.5">
          <span className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase block">
            Required for this step:
          </span>

          <div className="space-y-2">
            {step.parts.map((part) => (
              <div
                key={part.id}
                className="flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl px-3 py-2 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Quantity Pill */}
                  <span className="flex-shrink-0 bg-white/15 text-white font-mono font-bold text-xs px-2 py-0.5 rounded-md border border-white/10">
                    {part.qty}
                  </span>

                  {/* Part Details */}
                  <div className="truncate">
                    <p className="text-xs font-semibold text-white truncate">
                      {part.name}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono">
                      {part.dimensions}
                    </p>
                  </div>
                </div>

                {/* Color swatch / Material badge */}
                <div className="flex items-center gap-1.5 flex-shrink-0 pl-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/30 shadow-sm"
                    style={{ backgroundColor: part.color }}
                    title={`${part.material} (${part.color})`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pro Tip Callout */}
        {step.proTip && (
          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-start gap-2 text-gray-300">
            <Wrench size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-400 leading-tight">
              <span className="text-amber-400 font-semibold">Tip: </span>
              {step.proTip}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
