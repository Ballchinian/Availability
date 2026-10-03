/*
    Every write that changes something the edit form sends moves rev on, so a form opened
    before it is refused rather than saving over it. by is { id, name } of whoever made
    the change, for that refusal to name. Answers leave rev alone: the form never sends
    one, so it cannot save over one, and a plan people are busy answering would otherwise
    refuse every edit made to it.
*/
export function moved(update, by = null) {
    return { ...update, $set: { ...update.$set, revBy: by }, $inc: { rev: 1 } };
}
