import ExcelJS from 'exceljs';
import { type Browser, type BrowserContext, type Locator, type Page, expect, test } from '@playwright/test';

/**
 * A week at EMS, played in the browser by the people who'd do it: the General Manager sets up shifts, Ramadan hours
 * and a delivery lead; Maya clocks in and asks for leave; Fadi closes a clock-out he forgot; Khaled hands his approvals to Tariq, who approves; Maya and
 * Nour swap a shift; then the reports and Excel exports. Uses the demo team (src/server/seed.ts).
 */

const PEOPLE = {
  admin: 'huda.mansour@demo.ems-itech.com',
  khaled: 'khaled.yousef@demo.ems-itech.com',
  tariq: 'tariq.hamdan@demo.ems-itech.com',
  maya: 'maya.rahal@demo.ems-itech.com',
  nour: 'nour.abbas@demo.ems-itech.com',
  sami: 'sami.darwish@demo.ems-itech.com',
  /** Clocked in two working days ago on the demo site and never clocked out (seedDemoClock). */
  fadi: 'fadi.jaber@demo.ems-itech.com',
};

const amman = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(d);
const today = amman(new Date());
const inDays = (n: number) => amman(new Date(Date.now() + n * 864e5));
/** The first Sunday–Thursday at least `n` days away (Acme works Sunday to Thursday). */
const workday = (n: number) => {
  for (let i = n; ; i++) {
    const d = inDays(i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() <= 4) return d;
  }
};
/** The Sunday–Thursday `n` working days before today. */
const workdayAgo = (n: number) => {
  let d = today;
  for (let i = 1, back = 0; back < n; i++) {
    d = inDays(-i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() <= 4) back++;
  }
  return d;
};

interface AsOptions {
  locale?: 'ar';
}

/** Signs in as someone (demo sign-in) in their own browser, runs `fn`, and keeps a screenshot if it fails. */
async function as(browser: Browser, email: string, fn: (page: Page, ctx: BrowserContext) => Promise<void>, opts: AsOptions = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto('/signin');
    if (opts.locale === 'ar') {
      await page.click('button[name=locale][value=ar]');
      await page.waitForSelector('html[dir=rtl]');
    }
    await page.selectOption('#dev-email', email);
    await page.click('form:has(#dev-email) button');
    await page.waitForURL('/');
    await fn(page, ctx);
  } catch (e) {
    await page.screenshot({ path: test.info().outputPath(`failed-${email.split('@')[0]}.png`), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await ctx.close();
  }
}

/** Server actions redirect back with ?ok=… or ?error=…; wait for that. Call on a page whose URL has neither. */
async function submit(page: Page, button: Locator) {
  await Promise.all([page.waitForURL(/[?&](ok|error)=/), button.click()]);
}

/** Reloads the page without the previous action's ?ok= / ?error=, so the next submit can be waited for. */
async function fresh(page: Page) {
  const url = new URL(page.url());
  for (const key of ['ok', 'error', 'detail']) url.searchParams.delete(key);
  await page.goto(url.pathname + url.search);
}

const flash = (page: Page) => page.locator('.flash').first();

async function idOf(page: Page, name: string) {
  await page.goto('/people');
  const href = await page.locator(`a:has-text("${name}")`).first().getAttribute('href');
  return href!.split('/').pop()!;
}

async function openBell(page: Page) {
  await page.locator('.bell > summary').click();
  return page.locator('.bell-list');
}

test('a week at EMS, as the people who use it', async ({ browser }) => {
  let acme = '';
  const leaveDay = workday(12);
  const swapDay = workday(1);

  await test.step('Admin: Evening shift, Ramadan hours, Nour on evenings, Sami as delivery lead', async () => {
    await as(browser, PEOPLE.admin, async (page) => {
      await page.goto('/clients');
      await page.locator('a:has-text("Acme Investment")').first().click();
      await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
      acme = page.url().split('/').pop()!;

      await page.locator('summary', { hasText: 'Add a shift' }).click();
      await page.fill('#sn-new', 'Evening');
      await page.fill('#ss-new', '15:00');
      await page.fill('#se-new', '23:00');
      await submit(page, page.locator('form:has(#sn-new) button.btn-primary'));
      await expect(page.locator('.shift-row strong', { hasText: 'Evening' })).toHaveCount(1);

      await fresh(page);
      await page.locator('summary', { hasText: 'Add special hours' }).click();
      await page.fill('#season-name', 'Ramadan 2027');
      await page.fill('#season-from', '2027-02-07');
      await page.fill('#season-to', '2027-03-08');
      await page.fill('#season-start', '09:00');
      await page.fill('#season-end', '15:00');
      await submit(page, page.locator('form:has(#season-name) button.btn-primary'));
      const seasons = page.locator('section[aria-labelledby=seasons]');
      await expect(seasons).toContainText('Ramadan 2027');
      await expect(seasons).toContainText('6h a day');

      // Overlapping special hours are refused, with a message saying why.
      await fresh(page);
      await page.locator('summary', { hasText: 'Add special hours' }).click();
      await page.fill('#season-name', 'Overlap');
      await page.fill('#season-from', '2027-03-01');
      await page.fill('#season-to', '2027-03-15');
      await submit(page, page.locator('form:has(#season-name) button.btn-primary'));
      await expect(flash(page)).toContainText('overlap');

      const nour = await idOf(page, 'Nour Abbas');
      await page.goto(`/people/${nour}`);
      await page.locator('summary', { hasText: 'Put on a client shift' }).click();
      const evening = await page.locator('#shiftPick option', { hasText: 'Evening' }).first().getAttribute('value');
      await page.selectOption('#shiftPick', evening!);
      // From the swap day: a start before 1 October 2026 would sit under the 8h30 day's version from that date.
      await page.fill('#shiftFrom', swapDay);
      await submit(page, page.locator('form:has(#shiftPick) button.btn-primary'));
      await expect(page.locator('body')).toContainText('15:00');

      const maya = await idOf(page, 'Maya Rahal');
      await page.goto(`/people/${maya}`);
      const leadForm = page.locator('form:has(select[name=deliveryLeadId])').first();
      const sami = await leadForm.locator('option', { hasText: 'Sami Darwish' }).getAttribute('value');
      await leadForm.locator('select').selectOption(sami!);
      await submit(page, leadForm.locator('button'));
      await expect(page.locator('form:has(select[name=deliveryLeadId]) select').first()).toHaveValue(sami!);
    });
  });

  await test.step('Maya clocks in at the client site and asks for a day off; Sami (lead) is told, not asked', async () => {
    await as(browser, PEOPLE.maya, async (page) => {
      await page.locator('.clock-card input[value=client_site]').check({ force: true });
      await Promise.all([page.waitForURL('/'), page.locator('.clock-card button', { hasText: 'Clock in' }).click()]);
      await expect(page.locator('.clock-card .where-chip')).toHaveText('Client site');

      await page.goto(`/time-off?new=1&type=annual&from=${leaveDay}&to=${leaveDay}`);
      await submit(page, page.getByRole('button', { name: 'Send request' }));
      await expect(flash(page)).toContainText('Sent to your manager');
    });
    await as(browser, PEOPLE.sami, async (page) => {
      await expect(await openBell(page)).toContainText('Maya Rahal asked for time off');
      await page.goto('/approvals');
      await expect(page.locator('main')).not.toContainText('Maya Rahal');
    });
  });

  await test.step('Maya shares a status for the week; colleagues see her words beside her name', async () => {
    await as(browser, PEOPLE.maya, async (page) => {
      await page.locator('.status-fab').click();
      const panel = page.locator('.status-panel');
      // Nothing is picked until she chooses, so there's nothing to share yet.
      await expect(panel.getByRole('button', { name: 'Share' })).toBeDisabled();
      await panel.getByRole('radio', { name: 'In meetings' }).click();
      await panel.getByPlaceholder('Add a few words (optional)').fill('Workshop at the client all week');
      await panel.getByRole('radio', { name: 'This week' }).click();
      await Promise.all([page.waitForURL('/'), panel.getByRole('button', { name: 'Share' }).click()]);
    });
    await as(browser, PEOPLE.nour, async (page) => {
      await page.goto('/people');
      await expect(page.locator('tr', { hasText: 'Maya Rahal' }).locator('.status-line')).toContainText('Workshop at the client all week');
    });
  });

  await test.step('Fadi forgot to clock out two days ago: that day counts nothing and is flagged until he closes it', async () => {
    const forgotDay = workdayAgo(2);
    const log = async (page: Page) => {
      const fadi = await idOf(page, 'Fadi Jaber');
      await page.goto(`/attendance/${fadi}?month=${forgotDay.slice(0, 7)}`);
      return page.locator('tbody tr', { hasText: 'Clock-out missing' });
    };
    await as(browser, PEOPLE.admin, async (page) => {
      const missing = await log(page);
      await expect(missing).toHaveCount(1);
      // Not the ~50 hours since he clocked in: nothing, until he says when he left.
      await expect(missing.locator('td').nth(4).locator('strong')).toHaveText('—');
    });
    await as(browser, PEOPLE.fadi, async (page) => {
      const card = page.locator('.clock-forgot');
      await expect(card).toContainText('You’re still clocked in from');
      await page.fill('#clock-left', '17:30');
      await submit(page, card.getByRole('button'));
      await expect(page.locator('.clock-forgot')).toHaveCount(0);
      await expect(page.locator('.clock-card button', { hasText: 'Clock in' })).toBeVisible();
    });
    await as(browser, PEOPLE.admin, async (page) => {
      await expect(await log(page)).toHaveCount(0);
      await expect(page.locator('main')).toContainText('8h 25m');
    });
  });

  await test.step('Khaled hands his approvals to Tariq, who approves Maya’s leave for him', async () => {
    await as(browser, PEOPLE.khaled, async (page) => {
      await page.goto('/approvals');
      await expect(page.locator('main')).toContainText('Maya Rahal');
      const tariq = await page.locator('#deputyId option', { hasText: 'Tariq Hamdan' }).getAttribute('value');
      await page.selectOption('#deputyId', tariq!);
      await page.fill('#delegation-to', inDays(3));
      await submit(page, page.getByRole('button', { name: 'Hand over' }));
      await expect(page.locator('section[aria-labelledby=delegation]')).toContainText('Tariq Hamdan stands in');
    });
    await as(browser, PEOPLE.tariq, async (page) => {
      await page.goto('/approvals');
      await expect(page.locator('main')).toContainText('standing in for Khaled Yousef');
      await expect(page.locator('main')).toContainText('for Khaled Yousef');
      await page.locator('nav.inbox a', { hasText: 'Maya Rahal' }).first().click();
      await page.waitForURL(/[?&]l=/);
      await submit(page, page.getByRole('button', { name: /^Approve/ }).first());
      await expect(flash(page)).toContainText('Approved');
    });
    await as(browser, PEOPLE.maya, async (page) => {
      await expect(await openBell(page)).toContainText('Decided by Tariq Hamdan for Khaled Yousef');
    });
    await as(browser, PEOPLE.sami, async (page) => {
      await expect(await openBell(page)).toContainText('Maya Rahal’s time off was approved');
    });
  });

  await test.step('Maya and Nour swap a shift: ask, accept, approve, ⇄ on the roster', async () => {
    await as(browser, PEOPLE.maya, async (page) => {
      await page.goto(`/clients/${acme}/roster?week=${swapDay}`);
      const nour = await page.locator('#swap-with option', { hasText: 'Nour Abbas' }).getAttribute('value');
      await page.selectOption('#swap-with', nour!);
      await page.fill('#swap-date', swapDay);
      await page.fill('#swap-note', 'Family appointment in the morning');
      await submit(page, page.getByRole('button', { name: 'Ask to swap' }));
      await expect(page.locator('section[aria-labelledby=swap]')).toContainText('You asked Nour Abbas');

      // Same hours: there's nothing to swap, and the page says so.
      await fresh(page);
      const hani = await page.locator('#swap-with option', { hasText: 'Hani Barakat' }).getAttribute('value');
      await page.selectOption('#swap-with', hani!);
      await page.fill('#swap-date', workday(2));
      await submit(page, page.getByRole('button', { name: 'Ask to swap' }));
      await expect(flash(page)).toContainText('isn’t possible');
    });
    await as(browser, PEOPLE.nour, async (page) => {
      await page.goto(`/clients/${acme}/roster?week=${swapDay}`);
      const box = page.locator('section[aria-labelledby=swap]');
      await submit(page, box.getByRole('button', { name: 'Accept' }).first());
      await expect(page.locator('section[aria-labelledby=swap]')).toContainText('Waiting for the manager');
    });
    await as(browser, PEOPLE.khaled, async (page) => {
      await page.goto('/approvals');
      const swaps = page.locator('section[aria-labelledby=swaps]');
      await expect(swaps).toContainText('Maya Rahal ⇄ Nour Abbas');
      await submit(page, swaps.getByRole('button', { name: 'Approve' }).first());
      await page.goto(`/clients/${acme}/roster?week=${swapDay}`);
      await expect(page.locator('.swap-mark')).toHaveCount(2);
    });
  });

  await test.step('Reports: Attendance tab, Finance export (Attendance sheet, Where), client hours export', async () => {
    await as(browser, PEOPLE.admin, async (page, ctx) => {
      const month = today.slice(0, 7);
      await page.goto(`/reports?view=attendance&month=${month}`);
      await expect(page.locator('main')).toContainText('Days in');
      await expect(page.locator('main')).toContainText('Forgot to clock out');
      await expect(page.locator('main')).toContainText('Not using the clock yet');

      const res = await ctx.request.get(`/reports/export?month=${month}`);
      expect(res.ok()).toBe(true);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
      expect(wb.worksheets.slice(0, 2).map((w) => w.name)).toEqual(['Summary', 'Attendance']);
      const data = wb.getWorksheet('Data')!;
      const head = data.getRow(1).values as unknown[];
      const whereCol = head.indexOf('Where');
      expect(whereCol).toBeGreaterThan(0);
      let placed = 0;
      data.eachRow((row, i) => {
        if (i > 1 && (row.values as unknown[])[whereCol]) placed++;
      });
      expect(placed).toBeGreaterThan(0); // Maya's clock-in today, at the client site

      await page.goto(`/reports?month=${month}`);
      await page.selectOption('#client-hours', acme);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download client hours' }).click()]);
      expect(download.suggestedFilename()).toMatch(/^ems-acme-investment-hours-\d{4}-\d{2}\.xlsx$/);
      const clientBook = new ExcelJS.Workbook();
      await clientBook.xlsx.readFile((await download.path())!);
      expect(clientBook.getWorksheet('Summary')!.getCell('D2').value).toBe('Acme Investment · Hours');
    });
  });

  await test.step('Arabic: the Attendance tab and special hours render right to left', async () => {
    await as(
      browser,
      PEOPLE.admin,
      async (page) => {
        await page.goto(`/reports?view=attendance&month=${today.slice(0, 7)}`);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('main')).toContainText('الحضور');
        await page.goto(`/clients/${acme}`);
        await expect(page.locator('section[aria-labelledby=seasons]')).toContainText('ساعات خاصة');
      },
      { locale: 'ar' },
    );
  });
});
