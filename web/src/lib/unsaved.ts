import { onMount } from 'svelte';

/*
    Both availability screens are a grid painted into local state with one save
    button under it, so a close, a reload or a link out is thirty days of clicking
    gone with nothing said. Leaving is caught two ways, since the page has two ways
    out: the browser's own warning for a close or a reload, and the click itself for
    a hash link, which never fires beforeunload however far it moves you.

    The link half matters more than it sounds: "set your general availability" sits
    directly under the grid it would throw away.
*/
export function guardUnsaved(dirty: () => boolean) {
    onMount(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (!dirty()) return;
            e.preventDefault();
            //Older browsers only raise the prompt when returnValue is set as well
            e.returnValue = '';
        };

        /*
            Caught on the way down rather than on the anchor, so it lands before the
            router does, and only for the plain left click that stays in this tab: a
            middle click or a held modifier opens another one and leaves this grid alone.
        */
        const catchLink = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const link = (e.target as Element | null)?.closest?.('a');
            const href = link?.getAttribute('href') || '';
            if (!href.startsWith('#') || href === location.hash) return;
            if (!dirty()) return;
            if (!confirm('You have days marked that have not been saved. Leave without saving them?')) e.preventDefault();
        };

        window.addEventListener('beforeunload', warn);
        document.addEventListener('click', catchLink, true);
        return () => {
            window.removeEventListener('beforeunload', warn);
            document.removeEventListener('click', catchLink, true);
        };
    });
}

//A selection as one comparable string: days in order, each with its hours in order
export function selectionKey(selection: Record<string, number[]>) {
    return Object.keys(selection)
        .sort()
        .map((date) => `${date}:${[...selection[date]].sort((a, b) => a - b).join('.')}`)
        .join('|');
}
