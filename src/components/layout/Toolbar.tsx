import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * One sticky home for filters.
 *
 * Pages don't own a filter bar each — they render <Toolbar> anywhere in their
 * tree and its children are portalled into the strip the shell reserves under
 * the topbar. So the filters for Home, Calendar and the rest all land in the
 * same place, at the same height, without the pages knowing where that is.
 */
const ToolbarSlotContext = createContext<{
  node: HTMLDivElement | null;
  setNode: (node: HTMLDivElement | null) => void;
} | null>(null);

export function ToolbarProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return <ToolbarSlotContext.Provider value={{ node, setNode }}>{children}</ToolbarSlotContext.Provider>;
}

/** Rendered once by the shell: the strip that page filters portal into. */
export function ToolbarOutlet({ className }: { className?: string }) {
  const ctx = useContext(ToolbarSlotContext);
  return <div ref={ctx?.setNode} className={className} />;
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  const ctx = useContext(ToolbarSlotContext);
  if (!ctx?.node) return null;
  return createPortal(children, ctx.node);
}
