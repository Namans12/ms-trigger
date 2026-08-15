import { useEffect, useLayoutEffect, useRef } from "react";
import { Meteors } from "./Meteors";

interface IntroScreenProps {
  onEnter: () => void;
}

// Clamp how far the heading's font-size can be pushed while matching the
// tagline's width, so a very long/short tagline can't blow it up or shrink
// it to something illegible.
const MIN_HEADING_FONT_PX = 32;
const MAX_HEADING_FONT_PX = 140;

export function IntroScreen({ onEnter }: IntroScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const exitingRef = useRef(false);

  useLayoutEffect(() => {
    function matchWidthToTagline() {
      const heading = headingRef.current;
      const tagline = taglineRef.current;
      if (!heading || !tagline) return;

      heading.style.fontSize = ""; // reset to the CSS clamp so we measure its natural size
      const naturalFontSize = parseFloat(getComputedStyle(heading).fontSize);
      const naturalWidth = heading.getBoundingClientRect().width;
      const taglineWidth = tagline.getBoundingClientRect().width;
      if (!naturalWidth || !taglineWidth) return;

      const scaled = naturalFontSize * (taglineWidth / naturalWidth);
      heading.style.fontSize = `${Math.min(Math.max(scaled, MIN_HEADING_FONT_PX), MAX_HEADING_FONT_PX)}px`;
    }

    matchWidthToTagline();
    const ro = new ResizeObserver(matchWidthToTagline);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener("resize", matchWidthToTagline);
    document.fonts?.ready.then(matchWidthToTagline).catch(() => {});
    // Safety net for a late webfont swap shifting text metrics after fonts.ready resolves.
    const settleTimer = setTimeout(matchWidthToTagline, 400);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", matchWidthToTagline);
      clearTimeout(settleTimer);
    };
  }, []);

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
      <div className="intro-meteors" aria-hidden="true">
        <Meteors number={21} minDuration={3} maxDuration={9} />
      </div>

      <img
        src="/spotlight-transparent-window-mounted.png"
        alt=""
        className="intro-fixture"
        style={{ ["--rod-pct" as string]: "37.4%" }}
      />

      <div className="intro-copy relative flex flex-col items-center">
        <h1 ref={headingRef} className="intro-heading font-display">
          Sp<span className="intro-hit-letter">o</span>tl<span className="intro-glare">ight</span>
        </h1>
        <p ref={taglineRef} className="intro-tagline text-gradient mt-2">&mdash; Find what&apos;s worth watching &mdash;</p>
      </div>

      <button
        ref={buttonRef}
        onClick={handleEnter}
        className="intro-cta relative mt-10 inline-flex items-center gap-2 px-7 py-2.5 rounded-full bg-accent text-accent-foreground text-sm font-semibold hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all"
      >
        <span className="intro-cta-shine" aria-hidden="true" />
        <span className="relative z-10">Enter Spotlight</span>
      </button>
    </div>
  );
}
