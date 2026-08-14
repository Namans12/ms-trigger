import { useEffect, useRef } from "react";

interface IntroScreenProps {
  onEnter: () => void;
}

export function IntroScreen({ onEnter }: IntroScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const exitingRef = useRef(false);

  useEffect(() => {
    buttonRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        handleEnter();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEnter() {
    if (exitingRef.current) return;
    exitingRef.current = true;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !rootRef.current) {
      onEnter();
      return;
    }
    rootRef.current.classList.add("intro-exit");
    // animationend is the primary trigger; the timeout is a safety net in case
    // the tab was backgrounded (animations pause) or the event never fires.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onEnter();
    };
    rootRef.current.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, 600);
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Spotlight"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center bg-black overflow-hidden"
    >
      <img
        src="/spotlight-lockup.png"
        alt="Spotlight — Find what's worth watching"
        className="intro-lockup w-full max-w-lg sm:max-w-xl"
      />

      <button
        ref={buttonRef}
        onClick={handleEnter}
        className="intro-cta mt-10 inline-flex items-center gap-2 px-7 py-2.5 rounded-full bg-accent text-accent-foreground text-sm font-semibold hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all"
      >
        Enter Spotlight
      </button>
    </div>
  );
}
