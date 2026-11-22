// Browser smoke test: register -> calculator -> order -> pay. Needs Django (DEBUG, seeded) on :8000, Next on :3000.
// Run: NODE_PATH=<dir with playwright> node e2e/smoke.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const S = process.env.SHOTS_DIR || '/tmp/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('http://localhost:3000/ru/login');
  await p.fill('#ph', '+998901234567');
  await p.click('text=Получить код в Telegram');
  await p.waitForSelector('text=DEV:');
  const code = (await p.textContent('text=DEV:')).replace('DEV:', '').trim();
  await p.fill('#cd', code);
  await p.click('button:has-text("Войти")');
  await p.waitForSelector('text=Регистрация');
  for (const x of await p.$$('input[type=checkbox]')) await x.check();
  await p.click('button:has-text("Войти")');
  await p.waitForURL('**/ru');
  console.log('registered, url', p.url());
  await p.goto('http://localhost:3000/ru/calculator');
  await p.click('text=Далее');
  await p.waitForSelector('text=Зоны');
  await p.click('button:has-text("Рассчитать")');
  await p.waitForSelector('text=Итого');
  console.log('calc total:', (await p.textContent('p.price')).trim());
  await p.screenshot({ path: S + 'calc.png', fullPage: true });
  await p.click('text=Добавить всё в корзину');
  await p.waitForSelector('text=Добавлено в корзину');
  await p.goto('http://localhost:3000/ru/cart');
  await p.waitForSelector('button:has-text("Оформить заказ")');
  await p.click('button:has-text("Оформить заказ")');
  await p.waitForSelector('text=К оплате онлайн');
  console.log('order:', (await p.textContent('.card')).replace(/\s+/g, ' ').slice(0, 220));
  execFileSync('python', ['manage.py', 'shell', '-c',
    "from apps.payments import wallet;from apps.accounts.models import User;from decimal import Decimal;wallet.change(User.objects.get(phone='+998901234567'),Decimal('50000000'),'topup')"],
    { cwd: process.env.BACKEND_DIR || '../backend' });
  await p.goto('http://localhost:3000/ru/account');
  await p.click('button:has-text("Заказы")');
  await p.click('button:has-text("Оплатить с баланса")');
  await p.waitForSelector('.tag:has-text("Оплачен")');
  console.log('paid OK');
  await p.screenshot({ path: S + 'orders.png' });
  const m = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
  const mp = await m.newPage();
  await mp.goto('http://localhost:3000/uz');
  await mp.screenshot({ path: S + 'mobile_dark.png', fullPage: true });
  console.log('theme:', await mp.evaluate(() => document.documentElement.dataset.theme),
    'overflow-x:', await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('ERRORS:', JSON.stringify(errs.filter((e) => !/favicon/.test(e))));
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
