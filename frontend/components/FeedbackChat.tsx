// src/components/FeedbackChat.tsx
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage } from "../types";
import "highlight.js/styles/github-dark.css"; // choose a style you like

type Props = {
  messages: ChatMessage[];
  height?: number | string;
  showTyping?: boolean;
  className?: string;
};

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // allow className on code/span so rehype-highlight can add language-xxxx classes
    code: [...(defaultSchema.attributes?.code || []), ["className"]],
    span: [...(defaultSchema.attributes?.span || []), ["className"]],
    table: [...(defaultSchema.attributes?.table || [])],
  },
};

export const FeedbackChat: React.FC<Props> = ({
  messages,
  height = 280,
  showTyping = false,
  className = "",
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div
      className={`bg-slate-900 rounded-lg p-3 shadow-lg flex flex-col ${className}`}
      style={{ height }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-300">AI Feedback</h3>
        <div className="text-xs text-slate-500">{messages.length} messages</div>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-700"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="text-xs italic text-slate-500">No feedback yet.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex items-start gap-3 group">
              {/* Avatar */}
              <div className="flex-shrink-0 mt-1">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-sm font-medium select-none">
                  AI
                </div>
              </div>

              {/* Bubble */}
              <div className="relative flex-1">
                <div
                  className="bg-slate-800 text-slate-100 px-3 py-2 rounded-lg shadow-sm"
                  style={{ borderTopLeftRadius: 6, borderTopRightRadius: 12, borderBottomRightRadius: 12 }}
                >
                  {/* Markdown rendering (sanitized + highlighted) */}
                  <div className="prose prose-invert max-w-full">
                    <ReactMarkdown
                      children={m.text}
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[[rehypeSanitize, schema], rehypeHighlight]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a
                            {...props}
                            className="text-sky-400 underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                        code({ node, inline, className, children, ...props }) {
                          return inline ? (
                            <code className="rounded px-1 bg-slate-800 text-xs" {...props}>
                              {children}
                            </code>
                          ) : (
                            <pre className="rounded bg-slate-800 p-2 overflow-auto text-xs" {...props}>
                              <code className={className}>{children}</code>
                            </pre>
                          );
                        },
                        table: ({ node, ...props }) => (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm table-auto" {...props} />
                          </div>
                        ),
                        th: ({ node, ...props }) => <th className="px-2 py-1 text-left bg-slate-800" {...props} />,
                        td: ({ node, ...props }) => <td className="px-2 py-1" {...props} />,
                      }}
                    />
                  </div>
                </div>

                {/* timestamp + copy button row */}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">{m.timestamp}</span>

                  <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyText(m.id, m.text)}
                      className="text-[11px] text-slate-400 hover:text-slate-200"
                      aria-label="Copy feedback"
                      title="Copy"
                    >
                      {copiedId === m.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Typing indicator (optional) */}
        {showTyping && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-300 to-indigo-400 flex items-center justify-center text-white text-sm font-medium select-none">
                AI
              </div>
            </div>

            <div className="bg-slate-800 px-3 py-2 rounded-lg inline-block">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
                <span className="inline-block w-2 h-2 rounded-full bg-slate-500 animate-pulse delay-200" />
                <span className="inline-block w-2 h-2 rounded-full bg-slate-500 animate-pulse delay-400" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackChat;
