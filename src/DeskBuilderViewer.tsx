import React, { useEffect, useRef, useState } from "react";
import { ThreeDeskViewer } from "./three-scene";
import { DESK_BUILD_STEPS } from "./deskData";
import { LegoPartsCard } from "./LegoPartsCard";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  CheckCircle2,
} from "lucide-react";

interface DeskBuilderViewerProps {
  currentStep?: number;
  onStepChange?: (step: number) => void;
  showEmbeddedPartsCard?: boolean;
}

export const DeskBuilderViewer: React.FC<DeskBuilderViewerProps> = ({
  currentStep: externalStep,
  onStepChange: externalOnStepChange,
  showEmbeddedPartsCard = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ThreeDeskViewer | null>(null);

  const [internalStep, setInternalStep] = useState<number>(1);
  const currentStep = externalStep !== undefined ? externalStep : internalStep;
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const totalSteps = DESK_BUILD_STEPS.length;
  const activeStepData = DESK_BUILD_STEPS[currentStep - 1] || DESK_BUILD_STEPS[0];

  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new ThreeDeskViewer({
      container: containerRef.current,
      initialStep: currentStep,
    });
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Sync external step changes
  useEffect(() => {
    if (viewerRef.current && externalStep !== undefined) {
      viewerRef.current.setStep(externalStep);
    }
  }, [externalStep]);

  const handleStepChange = (step: number) => {
    const clamped = Math.max(1, Math.min(step, totalSteps));
    if (externalOnStepChange) {
      externalOnStepChange(clamped);
    } else {
      setInternalStep(clamped);
      if (viewerRef.current) {
        viewerRef.current.setStep(clamped);
      }
    }
  };

  const handleNext = () => handleStepChange(currentStep + 1);
  const handlePrev = () => handleStepChange(currentStep - 1);

  const handleToggleAutoRotate = () => {
    if (viewerRef.current) {
      const isAuto = viewerRef.current.toggleAutoRotate();
      setAutoRotate(isAuto);
    }
  };

  const handlePresetView = (view: "isometric" | "front" | "top" | "side" | "reset") => {
    if (viewerRef.current) {
      viewerRef.current.setPresetView(view);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentStep]);

  return (
    <div className="relative w-full h-[600px] md:h-[680px] rounded-3xl overflow-hidden border border-white/15 bg-[#0a0a0c] shadow-2xl flex flex-col transition-all">
      {/* 3D Canvas Viewport */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 cursor-grab active:cursor-grabbing outline-none"
      />

      {/* Embedded Lego Parts Callout (Optional - shown only when Right Widget is disabled) */}
      {showEmbeddedPartsCard && (
        <LegoPartsCard
          step={activeStepData}
          currentStepIndex={currentStep}
          totalSteps={totalSteps}
        />
      )}

      {/* Bottom Lego Instruction Manual Controller */}
      <div className="relative z-20 bg-[#121316]/95 backdrop-blur-md border-t border-white/10 p-4 md:p-5 text-white">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0 pr-4">
            <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider inline-block mb-1 whitespace-nowrap">
              Step {currentStep} of {totalSteps}
            </span>
            <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2 truncate">
              {activeStepData.title}
            </h3>
            <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">
              {activeStepData.description}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={handlePrev}
              disabled={currentStep === 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white font-semibold text-xs hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
              Previous
            </button>

            {currentStep < totalSteps ? (
              <button
                onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
              >
                Next Step
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={() => handleStepChange(1)}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 transition shadow-lg shadow-emerald-500/20"
              >
                Replay Build
                <RotateCw size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
