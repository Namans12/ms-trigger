import { useEffect, useRef } from "react";
import { SpotlightLogo } from "@/components/brand/SpotlightLogo";

interface IntroScreenProps {
  onEnter: () => void;
}

const WORDMARK = "Spotlight";

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
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center bg-background overflow-hidden"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(circle at 50% 32%, rgb(204 172 124 / 0.10), transparent 60%)" }}
      />

      <div className="relative w-24 h-24 sm:w-32 sm:h-32 mb-6">
        <SpotlightLogo fluid animated />
      </div>

      <h1 className="font-display text-5xl sm:text-6xl font-semibold tracking-tight text-foreground" aria-label={WORDMARK}>
        {WORDMARK.split("").map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="intro-letter inline-block"
            style={{ animationDelay: `${0.55 + i * 0.045}s` }}
          >
            {ch}
          </span>
        ))}
      </h1>

      <div className="intro-tagline flex items-center gap-3 mt-4">
        <span className="h-px w-8 bg-accent/50" />
        <p className="text-[11px] sm:text-xs font-medium tracking-[0.25em] uppercase text-muted-foreground">
          Find what&apos;s worth watching
        </p>
        <span className="h-px w-8 bg-accent/50" />
      </div>

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
