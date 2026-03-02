/**
 * Walk a Lexical JSON tree and collect unique mentionUserId values.
 * Returns an array of user ID strings.
 */
export function extractMentionUserIds(contentJson) {
    const ids = new Set();

    let parsed;
    try {
        parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    } catch (err) {
        console.error('[mentions] JSON parse failed:', err.message);
        return [];
    }

    if (!parsed) return [];

    const root = parsed?.root ?? parsed;
    if (!root || typeof root !== 'object') return [];

    function walk(node) {
        if (!node) return;
        if (node.type === 'mention' && node.mentionUserId) {
            ids.add(node.mentionUserId);
        }
        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }

    walk(root);
    return [...ids];
}
