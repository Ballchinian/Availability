import { config } from '../config.js';

/*
    The "Log in with Discord" plumbing. We only ask for the identify scope, which
    gives us their id, name and avatar. That is enough to know exactly who is on
    the site and to greet them, with no password of our own to look after.
*/

const DISCORD_API = 'https://discord.com/api';
const SCOPES = ['identify'];

//Send the person to Discord to approve the login
export function buildAuthorizeUrl(state) {
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state
    });
    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

//Trade the one time code Discord hands back for an access token
export async function exchangeCode(code) {
    const body = new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discord.redirectUri
    });

    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    return res.json();
}

//Use the token to read who just logged in
export async function fetchDiscordUser(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`user fetch failed (${res.status})`);

    const u = await res.json();
    return {
        id: u.id,
        username: u.username,
        displayName: u.global_name || u.username,
        avatar: avatarUrl(u.id, u.avatar)
    };
}

//Builds a full CDN url, falling back to Discord's default avatar set
export function avatarUrl(userId, avatarHash) {
    if (avatarHash) {
        const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}`;
    }
    //Default avatar index for the new username system
    const index = Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
