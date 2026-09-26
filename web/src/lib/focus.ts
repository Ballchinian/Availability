import { tick } from 'svelte';

/*
    For a control that takes itself away when pressed. Once the page has redrawn, and only
    if focus went with it, focus goes to whatever stands in its place, rather than dropping
    to the top of the page where a keyboard has to start again from the first link.
*/
export async function refocus(find: () => HTMLElement | null | undefined) {
    await tick();
    const at = document.activeElement;
    //A control gone disabled holds focus until the next frame and then drops it, so it counts as lost
    if (at && at !== document.body && at.isConnected && !at.matches(':disabled')) return;
    const el = find();
    if (!el) return;
    //A result line or a box, which takes focus from here without joining the tab order
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus();
}
