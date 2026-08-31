/**
 * A text field that is exactly as tall as the words in it.
 *
 * Every fixed-height field in this console lies about its own content. A lesson title
 * in a one-line <input> scrolls sideways and shows you two thirds of it; an objective
 * in rows={2} hides its third line behind an inner scrollbar. Both were visible in one
 * screenshot of the live app, and the reason is the same: the box was sized when it was
 * written, not when it was filled. A teacher cannot check words they cannot see.
 *
 * So the field grows with its value, up to `maxLines`, and only then scrolls. It also
 * re-measures when its WIDTH changes — which is the case that produced the screenshot:
 * opening the assistant sidebar takes 400px off the page, every line re-wraps, and a
 * height measured before that is wrong.
 *
 * `singleLine` keeps a title a title. It still wraps to as many visual lines as it
 * needs; it just never takes a newline into the value.
 */
import { forwardRef, useCallback, useLayoutEffect, useRef, type KeyboardEvent } from "react";

export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (next: string) => void;
    /** Grow to at most this many lines, then scroll. */
    maxLines?: number;
    /** Enter never lands a newline, and pasted newlines collapse to spaces. */
    singleLine?: boolean;
    onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    className?: string;
    placeholder?: string;
    disabled?: boolean;
    "aria-label"?: string;
  }
>(function AutoTextarea(
  { value, onChange, maxLines = 8, singleLine = false, onKeyDown, className = "", ...rest },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // The cap is derived from the LIVE line-height and padding rather than hard-coded, so
  // it stays right when the type scale changes underneath it.
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // scrollHeight excludes the border; the box is border-box, so height must include it.
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const max = Math.ceil(lineHeight * maxLines + pad + border);
    el.style.height = "auto";
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [maxLines]);

  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  // Width changes re-wrap the text, which changes the height. Setting our own height
  // fires this too, so it only acts on a real width change — no measure loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const node = ref.current;
      if (!node || node.clientWidth === lastWidth) return;
      lastWidth = node.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea
      {...rest}
      ref={(node) => {
        ref.current = node;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      rows={1}
      value={value}
      onChange={(event) =>
        onChange(singleLine ? event.target.value.replace(/[\r\n]+/g, " ") : event.target.value)
      }
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (singleLine && event.key === "Enter" && !event.defaultPrevented) event.preventDefault();
      }}
      className={`resize-none ${className}`}
    />
  );
});
