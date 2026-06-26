import crypto from 'crypto';

/*
    Short, url friendly ids for plans. Random base62 is plenty unique for the
    handful of plans a group makes, and it keeps the link short enough to paste.
*/

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function shortId(length = 10) {
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}
