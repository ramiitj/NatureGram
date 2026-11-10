/**
 * The address of a species' public field-guide page (/species/:slug), rendered by the server.
 * Mirrors slugify in server/seo.js; the server also accepts any common or scientific name's slug
 * and redirects to the species' own page.
 */
export const speciesSlug = (name: string): string =>
  String(name ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

export const speciesPath = (name: string) => {
  const slug = speciesSlug(name);
  return slug ? `/species/${slug}` : null;
};
