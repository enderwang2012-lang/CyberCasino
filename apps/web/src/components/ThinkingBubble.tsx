"use client";

import React from "react";
import "./ThinkingBubble.css";

interface ThinkingBubbleProps {
  message?: string;
  isBluffing?: boolean;
  thinkingSource?: "llm" | "strategy" | "rule";
  isLoading?: boolean;
  confidence?: number;
}

export const ThinkingBubble: React.FC<ThinkingBubbleProps> = ({
  message,
  isBluffing = false,
  thinkingSource = "llm",
  isLoading = false,
  confidence,
}) => {
  if (isLoading && !message) {
    return (
      <div className="thinking-bubble">
        <div className="thinking-bubble__loading">
          <span>AI 思考中</span>
          <span className="thinking-bubble__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    );
  }

  if (!message) return null;

  const sourceClass = thinkingSource === "strategy" ? "thinking-bubble--strategy" : "";
  const bluffClass = isBluffing ? "thinking-bubble--bluff" : "";

  return (
    <div className={`thinking-bubble ${sourceClass} ${bluffClass}`}>
      <div>&ldquo;{message}&rdquo;</div>
      {isBluffing && <div className="thinking-bubble__bluff-tag">BLUFF</div>}
      {thinkingSource === "strategy" && (
        <div className="thinking-bubble__source" style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
          纯策略模式
        </div>
      )}
      {confidence !== undefined && (
        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.5 }}>
          置信度 {Math.round(confidence * 100)}%
        </div>
      )}
    </div>
  );
};
