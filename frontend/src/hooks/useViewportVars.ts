import { useEffect } from "react";

/**
 * Keeps `--vvh` (visual viewport height) and the `kb-open` class in sync so that pages sized with
 * `.page-h` stay usable when the on-screen keyboard opens (iOS Safari does not resize the layout
 * viewport; Android Chrome may). While a text field is focused on a phone the bottom bar is hidden.
 */
export function useViewportVars() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let focused = false;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      root.style.setProperty("--vvh", `${Math.round(h)}px`);
      const shrunk = !!vv && window.innerHeight - vv.height > 150;
      root.classList.toggle("kb-open", shrunk || (focused && window.innerWidth < 768));
      if (shrunk) window.scrollTo(0, 0); // iOS may scroll the page under the keyboard
    };
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const onIn = (e: FocusEvent) => {
      if (isField(e.target)) {
        clearTimeout(outTimer);
        focused = true;
        update();
      }
    };
    let outTimer: ReturnType<typeof setTimeout> | undefined;
    const onOut = () => {
      // focus often hops between fields/buttons for a moment; only leave "keyboard mode" if it really left
      clearTimeout(outTimer);
      outTimer = setTimeout(() => {
        focused = isField(document.activeElement);
        update();
      }, 200);
    };
    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      root.classList.remove("kb-open");
      root.style.removeProperty("--vvh");
    };
  }, []);
}
