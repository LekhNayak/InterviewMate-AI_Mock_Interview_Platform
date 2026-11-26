import { useLayoutEffect, useRef } from "react";

/**
 * Gives an element the height left between its top and the bottom of the
 * window, so a page fits the screen and its panels scroll instead of the page.
 */
export function useFillViewport<T extends HTMLElement>(minHeight = 360) {
    const ref = useRef<T>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const fit = () => {
            const top = el.getBoundingClientRect().top + window.scrollY;
            el.style.height = `${Math.max(minHeight, window.innerHeight - top)}px`;
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [minHeight]);
    return ref;
}
