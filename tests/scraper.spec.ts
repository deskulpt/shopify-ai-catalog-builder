import { test, expect } from '@playwright/test';

test.describe('Scraper App E2E Tests', () => {
  
  // Note: To run this test, you must be authenticated into the Shopify Admin.
  // We recommend using Playwright's global setup to save the auth state.
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('Create Profile & Auto-Detect Patterns', async ({ page }) => {
    // Navigate to the local app environment (Shopify iframe will wrap this in production)
    await page.goto('http://localhost:5173'); 
    
    // Switch to Website Crawler tab
    await page.getByRole('tab', { name: 'Website Crawler' }).click();
    
    // Open New Website Profile modal
    await page.getByRole('button', { name: 'New Website Profile' }).click();
    
    // Fill in Ivy USA test site
    await page.getByLabel('Root Website URL').fill('https://ivyusa.com');
    await page.getByLabel('Profile Name').fill('Ivy USA Test');
    
    // Click Auto-Detect Patterns
    await page.getByRole('button', { name: 'Auto-Detect Patterns' }).click();
    
    // Wait for the AI/Crawler to detect paths
    await expect(page.getByLabel('Product URL Pattern')).toHaveValue('/products/', { timeout: 15000 });
    await expect(page.getByLabel('Category/Collection Pattern')).toHaveValue('/collections/', { timeout: 15000 });
    
    // Save Profile
    await page.getByRole('button', { name: 'Save Profile' }).click();
  });

  test('Initial AI Extraction (Template Generation)', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.getByRole('tab', { name: 'Website Crawler' }).click();
    
    // Select the profile
    await page.getByRole('button', { name: 'Ivy USA Test' }).click();
    
    // Ingest a product URL
    await page.getByLabel('Add Product/Category URL').fill('https://ivyusa.com/products/hersteller-nearby-scented-balm-solid-perfume-3g?variant=43753653207099');
    await page.getByRole('button', { name: 'Add to Queue' }).click();
    
    // Start Extraction
    await page.getByRole('button', { name: 'Start Extraction' }).first().click();
    
    // The first extraction takes longer as Gemini generates CSS rules
    // Wait for extraction to complete by looking for the Title in the UI
    await expect(page.getByText('hersteller nearby scented balm')).toBeVisible({ timeout: 30000 });
    
    // Verify specific data points
    await expect(page.getByText('43753653207099')).toBeVisible(); // Variant ID check
  });

  test('Deterministic Fast-Path Extraction', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.getByRole('tab', { name: 'Website Crawler' }).click();
    
    // Select the profile
    await page.getByRole('button', { name: 'Ivy USA Test' }).click();
    
    // Provide a DIFFERENT product from the same domain to test fast-path
    await page.getByLabel('Add Product/Category URL').fill('https://ivyusa.com/products/some-other-product');
    await page.getByRole('button', { name: 'Add to Queue' }).click();
    
    const startTime = Date.now();
    await page.getByRole('button', { name: 'Start Extraction' }).first().click();
    
    // Should be extremely fast now because it uses BeautifulSoup CSS Selectors instead of LLM
    await expect(page.getByText('some-other-product title', { exact: false })).toBeVisible({ timeout: 5000 });
    
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000); // Fast path must be under 5 seconds
  });
});
