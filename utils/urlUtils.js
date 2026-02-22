export const SITE_URL = 'https://iskrib.com';

export const makePostUrl = (journalId, title = '') => {
    const slug = title
        ? title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        : '';
    return `${SITE_URL}/home/post/${journalId}${slug ? '/' + slug : ''}`;
};
