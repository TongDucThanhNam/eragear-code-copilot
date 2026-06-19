"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MovingBorderProps {
  children: ReactNode;
  duration?: number;
  containerClassName?: string;
  borderClassName?: string;
  borderWidth?: number;
  borderRadius?: string;
}

export const MovingBorder = ({
  children,
  duration = 4,
  containerClassName,
  borderClassName,
  borderWidth = 1,
  borderRadius = "0",
}: MovingBorderProps) => {
  return (
    <div
      className={cn("relative", containerClassName)}
      style={{
        borderRadius,
        padding: borderWidth,
      }}
    >
      {/* Soft glow layer (behind) */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-40 blur-[3px]"
        style={{
          borderRadius,
        }}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width: "300vmax",
            height: "300vmax",
            background:
              "conic-gradient(from 0deg, transparent 0%, transparent 50%, rgba(96, 165, 250, 0.4) 60%, rgba(59, 130, 246, 0.7) 70%, rgba(96, 165, 250, 0.7) 80%, rgba(59, 130, 246, 0.4) 90%, transparent 95%, transparent 100%)",
            animation: `moving-border-spin ${duration}s linear infinite`,
          }}
        />
      </div>

      {/* Sharp border layer */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden",
          borderClassName
        )}
        style={{
          borderRadius,
        }}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width: "300vmax",
            height: "300vmax",
            background:
              "conic-gradient(from 0deg, transparent 0%, transparent 55%, rgba(59, 130, 246, 0.2) 60%, rgba(96, 165, 250, 0.5) 68%, rgba(147, 197, 253, 0.8) 75%, rgba(191, 219, 254, 1) 80%, rgba(147, 197, 253, 0.8) 85%, rgba(96, 165, 250, 0.5) 92%, rgba(59, 130, 246, 0.2) 96%, transparent 100%)",
            animation: `moving-border-spin ${duration}s linear infinite`,
          }}
        />
      </div>

      {/* Content with solid background */}
      <div
        className="relative bg-background"
        style={{
          borderRadius:
            borderRadius === "0"
              ? "0"
              : `calc(${borderRadius} - ${borderWidth}px)`,
        }}
      >
        {children}
      </div>

      <style>{`
        @keyframes moving-border-spin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};
