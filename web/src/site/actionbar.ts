/*
    Measures the sticky save bar into --actionbar on the page, which the stylesheet turns
    into scroll-padding-bottom. An attachment on the bar, so the padding goes with it.
*/
export function measureBar(bar: HTMLElement) {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--actionbar', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => {
        observer.disconnect();
        root.style.removeProperty('--actionbar');
    };
}
