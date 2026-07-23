import { test, expect } from '@playwright/test';

// Smoke tests: verify the app boots and renders its landing shell without
// crashing. Deliberately shallow — these guard against build/deploy-time
// breakage (a bad import, a syntax error that only surfaces at runtime, a
// crashed root render), not full user flows. Deeper interactive flows
// (camera/mic-dependent Live sessions, Firebase-authenticated actions)
// aren't covered here since they need real device/network access this
// suite doesn't assume.

test('landing page loads without an uncaught page error', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');

  await expect(page).toHaveTitle(/NatureGram/);
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toEqual([]);
});

test('landing page renders the core hero and call-to-action', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'NatureGram', exact: true })).toBeVisible();
  await expect(page.getByText('Start a Live Expedition')).toBeVisible();
});

test('community feed view (/feed) loads without an uncaught page error', async ({ page }) => {
  // Exercises components/Community.tsx directly (default anonymous user
  // mode means no login click is needed to reach it). Tolerant of the
  // feed being empty/erroring against a live backend from this
  // environment — the point is confirming the component itself doesn't
  // crash on mount, not that specific posts load.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/feed');

  // .first(): at desktop viewport widths the "NatureGram" wordmark
  // legitimately appears twice — once in the page header, once in the
  // persistent sidebar nav — which is expected, not a bug.
  await expect(page.getByText('NatureGram', { exact: true }).first()).toBeVisible();
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toEqual([]);
});

test('species map view (/map) loads without an uncaught page error', async ({ page }) => {
  // Exercises components/SpeciesMap.tsx directly. Tolerant of the
  // Firestore read failing/timing out against a live backend from this
  // environment — the point is confirming Leaflet initializes and the
  // component doesn't crash on mount, not that pins actually load.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/map');

  await expect(page.getByRole('heading', { name: 'Species Map', exact: true })).toBeVisible();
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toEqual([]);
});

test('share route responds for a non-existent post without crashing the server', async ({ request }) => {
  // Exercises server/server.js's /s/:postId route (crawler-preview branch is
  // gated on User-Agent, so a plain request here takes the human-redirect
  // path) — just confirms the route doesn't 500.
  const response = await request.get('/s/nonexistent-post-id', { maxRedirects: 0 });
  expect(response.status()).toBeLessThan(500);
});
