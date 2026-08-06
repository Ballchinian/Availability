import { onMount } from 'svelte';

/*
    Both availability screens are a grid painted into local state with one save
    button under it, so a close, a reload or a link out is thirty days of clicking
    gone with nothing said. This is the browser's own warning, which is all a page
    is allowed to ask for.

    Hash navigation inside the app never fires beforeunload, so the links between
    screens are still a way to lose it.
*/
export function guardUnsaved(dirty: () => boolean) {
    onMount(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (!dirty()) return;
            e.preventDefault();
            //Older browsers only raise the prompt when returnValue is set as well
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    });
}

//A selection as one comparable string: days in order, each with its hours in order
export function selectionKey(selection: Record<string, number[]>) {
    return Object.keys(selection)
        .sort()
        .map((date) => `${date}:${[...selection[date]].sort((a, b) => a - b).join('.')}`)
        .join('|');
}
