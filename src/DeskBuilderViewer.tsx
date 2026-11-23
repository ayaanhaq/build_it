import React, { useEffect, useRef, useState } from "react";
import { ThreeDeskViewer } from "./three-scene";
import { DESK_BUILD_STEPS } from "./deskData";
import { LegoPartsCard } from "./LegoPartsCard";
import type { Scene } from "./types";
import { DESK_SCENE } from "./fixtures/desk.scene";
import { sceneStepToBuildStep } from "./builds";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Layers,
} from "lucide-react";

interface DeskBuilderViewerProps {
  scene?: Scene;
  currentStep?: number;
  onStepChange?: (step: number) => void;
  showEmbeddedPartsCard?: boolean;
  highlightedPartName?: string | null;
  onPartSelected?: (partName: string) => void;
}

export const DeskBuilderViewer: React.FC<DeskBuilderViewerProps> = ({
  scene,
  currentStep: externalStep,
  onStepChange: externalOnStepChange,
  showEmbeddedPartsCard = false,
  highlightedPartName,
  onPartSelected,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ThreeDeskViewer | null>(null);

  const activeScene = scene || DESK_SCENE;
  const [internalStep, setInternalStep] = useState<number>(1);
  const currentStep = externalStep !== undefined ? externalStep : internalStep;
  const totalSteps = activeScene ? activeScene.steps.length : DESK_BUILD_STEPS.length;
  const activeStepData = activeScene && activeScene.steps[currentStep - 1]
    ? sceneStepToBuildStep(activeScene.steps[currentStep - 1])
    : (DESK_BUILD_STEPS[currentStep - 1] || DESK_BUILD_STEPS[0]);

  // Hover callout state (Pass 8 Analytical 2D Leader Callouts)
  const [hoverCallout, setHoverCallout] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new ThreeDeskViewer({
      container: containerRef.current,
      initialStep: currentStep,
      scene: activeScene,
      onPartHover: (partName, x, y) => {
        if (partName) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            setHoverCallout({
              name: partName,
              x: x - rect.left,
              y: y - rect.top,
            });
          }
        } else {
          setHoverCallout(null);
        }
      },
      onPartClick: (partName) => {
        if (onPartSelected) onPartSelected(partName);
      },
    });
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Sync scene changes
  useEffect(() => {
    if (viewerRef.current && scene) {
      viewerRef.current.loadScene(scene);
    }
  }, [scene]);

  // Sync external step changes
  useEffect(() => {
    if (viewerRef.current && externalStep !== undefined) {
      viewerRef.current.setStep(externalStep);
    }
  }, [externalStep]);

  // Sync external part highlights
  useEffect(() => {
    if (viewerRef.current && highlightedPartName !== undefined) {
      viewerRef.current.highlightPartByName(highlightedPartName);
    }
  }, [highlightedPartName]);

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

      {/* HeyClicky Analytical Leader Line Callout Capsule */}
      {hoverCallout && (
        <div
          className="pointer-events-none absolute z-30 transform -translate-x-1/2 -translate-y-12 transition-all duration-75"
          style={{ left: hoverCallout.x, top: hoverCallout.y }}
        >
          <div className="flex items-center gap-2 bg-[#18191c]/95 backdrop-blur-md border border-amber-400/50 px-3 py-1.5 rounded-full shadow-2xl">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="text-xs font-semibold text-white tracking-wide">
              {hoverCallout.name}
            </span>
          </div>
          {/* Subtle leader tick */}
          <div className="w-[1.5px] h-3 bg-amber-400/80 mx-auto" />
        </div>
      )}

      {/* Embedded Lego Parts Callout (Optional) */}
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
            <h3 className="text-base md:text-lg font-bold text-white truncate">
              {activeStepData.title}
            </h3>
            <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">
              {activeStepData.description}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-shrink-0">
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
