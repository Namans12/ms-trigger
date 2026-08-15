import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "../../lib/utils";

// Adapted from MagicUI's Meteors (https://magicui.design/docs/components/meteors),
// reskinned to warm gold/cream sparks for the Spotlight intro instead of the
// original zinc/white streaks, and skipped entirely under reduced motion.
interface MeteorsProps {
  number?: number;
  minDelay?: number;
  maxDelay?: number;
  minDuration?: number;
  maxDuration?: number;
  angle?: number;
  className?: string;
}

export function Meteors({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 3,
  maxDuration = 9,
  angle = 215,
  className,
}: MeteorsProps) {
  const [meteorStyles, setMeteorStyles] = useState<CSSProperties[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const styles = Array.from({ length: number }, () => ({
      ["--meteor-angle" as string]: `${-angle}deg`,
      top: "-5%",
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * (maxDelay - minDelay) + minDelay}s`,
      animationDuration: `${Math.floor(Math.random() * (maxDuration - minDuration) + minDuration)}s`,
    }));
    setMeteorStyles(styles);
  }, [number, minDelay, maxDelay, minDuration, maxDuration, angle]);

  return (
    <>
      {meteorStyles.map((style, idx) => (
        <span key={idx} style={style} className={cn("intro-meteor", className)}>
          <span className="intro-meteor-tail" />
        </span>
      ))}
    </>
  );
}
