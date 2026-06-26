/*
    Shapes the API hands back that more than one screen leans on. The big
    response objects stay loose (any) on purpose, these are just the bits we pass
    between components and want to keep honest.
*/

export interface Member {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
}
