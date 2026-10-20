"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DemoPlaceholder } from "./chrome";
import type { AgentDemoPlayerProps } from "./player";

// The player is its own chunk, fetched only as the demo nears the viewport (it sits below the fold),
// so it never competes with the hero. Until then, and while it loads, the same-sized placeholder
// holds its place.
const Player = lazy(() => import("./player").then((module) => ({ default: module.AgentDemoPlayer })));

/** How far ahead of the viewport the player starts loading. */
const AHEAD = "600px 0px";

export function AgentDemoLazy(props: AgentDemoPlayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: AHEAD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const placeholder = <DemoPlaceholder label={props.script.label} />;
  return (
    <div ref={ref}>
      {near ? (
        <Suspense fallback={placeholder}>
          <Player {...props} />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  );
}
