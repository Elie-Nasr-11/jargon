import { useEffect, useState } from "react";

// Live coarse-pointer detection (touch-first devices): hover-revealed affordances must be always
// visible there — there is no hover. Re-evaluates if a pointer is attached/detached.
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const onChange = () => setCoarse(!mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
