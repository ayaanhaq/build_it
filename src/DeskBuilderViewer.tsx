import React, { useEffect, useRef, useState } from "react";
import { ThreeDeskViewer } from "./three-scene";
import { DESK_BUILD_STEPS } from "./deskData";
import { LegoPartsCard } from "./LegoPartsCard";
import type { Scene, SceneStep } from "./types";
import { DESK_SCENE } from "./fixtures/desk.scene";
import { sceneStepToBuildStep } from "./builds";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type GenerationUiStatus =
  | "idle"
  | "streaming"
  | "complete"
  | "error"
  | "cancelled";

interface DeskBuilderViewerProps {
  scene?: Scene;
  streamedSteps?: SceneStep[];
  skipLoadSceneName?: string | null;
  currentStep?: number;
  onStepChange?: (step: number) => void;
  showEmbeddedPartsCard?: boolean;
  highlightedPartName?: string | null;
  onPartSelected?: (partName: string) => void;
  viewerRef?: React.MutableRefObject<ThreeDeskViewer | null>;
  onViewerReady?: (viewer: ThreeDeskViewer) => void;
  isGenerating?: boolean;
  generationStatus?: GenerationUiStatus;
  generationStepCount?: number;
  generationError?: string | null;
  onCancelGeneration?: () => void;
}

export const DeskBuilderViewer: React.FC<DeskBuilderViewerProps> = ({
  scene,
  streamedSteps,
  skipLoadSceneName = null,
  currentStep: externalStep,
  onStepChange: externalOnStepChange,
  showEmbeddedPartsCard = false,
  highlightedPartName,
  onPartSelected,
  viewerRef: externalViewerRef,
  onViewerReady,
  isGenerating = false,
  generationStatus = "idle",
  generationStepCount = 0,
  generationError = null,
  onCancelGeneration,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalViewerRef = useRef<ThreeDeskViewer | null>(null);
  const viewerRef = externalViewerRef || internalViewerRef;
  const hasMountedRef = useRef<boolean>(false);
  const lastLoadedSceneRef = useRef<Scene | undefined>(scene);

  const activeScene = scene || DESK_SCENE;
  const displaySteps =
    streamedSteps && streamedSteps.length > 0
      ? streamedSteps
      : activeScene
      ? activeScene.steps
      : [];
  const [internalStep, setInternalStep] = useState<number>(1);
  const currentStep = externalStep !== undefined ? externalStep : internalStep;
  const totalSteps = displaySteps.length;
  const safeCurrentStep =
    totalSteps > 0 ? Math.max(1, Math.min(currentStep, totalSteps)) : 1;
  const activeStepData =
    displaySteps[safeCurrentStep - 1]
      ? sceneStepToBuildStep(displaySteps[safeCurrentStep - 1])
      : totalSteps === 0
      ? {
          stepNumber: 1,
          title: isGenerating
            ? "Waiting for first build step..."
            : activeScene?.title || "3D Build Viewer",
          subtitle: "Streaming",
          description: isGenerating
            ? "Generating validated 3D assembly instructions..."
            : "Send a request to generate build steps.",
          parts: [],
        }
      : DESK_BUILD_STEPS[0];

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
    onViewerReady?.(viewer);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Sync scene changes only for fixed/finished scenes, never while actively streaming
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastLoadedSceneRef.current = scene;
      return;
    }
    if (isGenerating || !scene || scene === lastLoadedSceneRef.current) {
      return;
    }
    lastLoadedSceneRef.current = scene;
    if (skipLoadSceneName && scene.name === skipLoadSceneName) {
      return;
    }
    if (viewerRef.current) {
      viewerRef.current.loadScene(scene);
      if (externalStep !== undefined && scene.steps.length > 0) {
        viewerRef.current.setStep(
          Math.min(externalStep, scene.steps.length),
          false
        );
      }
    }
  }, [scene, isGenerating, skipLoadSceneName]);

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

      {/* Generation Loading State & Cancel Button */}
      {(isGenerating || generationStatus === "streaming") && (
        <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between gap-3 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2.5 bg-amber-500/20 border border-amber-500/40 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-mono text-amber-300 shadow-xl">
            <Loader2 size={14} className="animate-spin text-amber-400" />
            <span>
              Generating build steps... ({generationStepCount} completed)
            </span>
          </div>

          {onCancelGeneration && (
            <button
              type="button"
              onClick={onCancelGeneration}
              className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/35 border border-red-400/50 text-xs font-mono font-semibold text-red-200 backdrop-blur-md transition shadow-xl"
            >
              <XCircle size={14} className="text-red-400" />
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Generation Complete State Badge */}
      {!isGenerating && generationStatus === "complete" && !generationError && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/40 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-mono text-emerald-300 shadow-xl">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span>Build complete ({generationStepCount} steps)</span>
        </div>
      )}

      {/* Generation Cancelled State Badge */}
      {!isGenerating && generationStatus === "cancelled" && !generationError && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-amber-500/15 border border-amber-400/40 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-mono text-amber-200 shadow-xl">
          <XCircle size={14} className="text-amber-400" />
          <span>
            Generation was cancelled ({generationStepCount} steps rendered)
          </span>
        </div>
      )}

      {/* Generation Error Banner */}
      {generationError && (
        <div className="absolute top-4 left-4 right-4 z-30 flex items-center gap-2 bg-red-950/90 border border-red-500/50 backdrop-blur-md px-4 py-2.5 rounded-2xl text-xs text-red-200 shadow-2xl">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <span className="truncate">{generationError}</span>
        </div>
      )}

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
              {totalSteps > 0 ? `Step ${safeCurrentStep} of ${totalSteps}` : "Preparing build"}
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
              disabled={safeCurrentStep <= 1 || totalSteps === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white font-semibold text-xs hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
              Previous
            </button>

            {safeCurrentStep < totalSteps ? (
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
                disabled={totalSteps === 0}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-lg shadow-emerald-500/20"
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
