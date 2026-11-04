import { expect, test } from "@playwright/test"

const mockAPI = `
import { createBackend } from '/tests/backend.ts';
const backend = createBackend();
window.__mygitTestBackend = backend;
const proxy = (name) => new Proxy({}, {get: (_, method) => (...args) => backend.call(name+'.'+String(method), ...args)});
export const Workspace = proxy('WorkspaceService'), Git = proxy('RepositoryService'), Desktop = proxy('DesktopService'), Term = proxy('TerminalService');
export function action(Kind, Path, values={}) {return {Kind,Path,Ref:'',Name:'',Value:'',Message:'',Remote:'',Files:[],Area:0,Confirm:false,Force:false,Keep:true,Untracked:true,NoCommit:false,Rebase:false,Autostash:false,UpdateRefs:false,Track:false,Tags:false,Parent:0,Mode:'',Plan:[],...values}}
export function changeRequest(Path,Mode='changes',Revision='',extra={}) {return {Path,Mode,Revision,From:'',To:'',File:'',...extra}}
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/src/lib/api.ts', route => route.fulfill({ contentType: 'application/javascript', body: mockAPI }));
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Stage all', exact: true})).toBeVisible();
});

test('diff text renders, can be selected, and has a working copy menu', async ({ page }, info) => {
  const code = page.getByText('package new', {exact: true});
  await expect(code).toBeVisible();
  await code.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('package new');
  await code.click({button: 'right'});
  await expect(page.getByRole('menuitem', {name: 'Copy after', exact: true})).toBeVisible();
  await page.getByRole('menuitem', {name: 'Copy after', exact: true}).click();
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.copied)).toEqual(['package new\n']);
  await page.screenshot({path: info.outputPath('changes.png')});
});

test('history renders an SVG graph and opens commit details', async ({ page }, info) => {
  await page.getByRole('button', {name: 'All commits', exact: true}).click();
  const row = page.getByRole('row').filter({hasText: 'Initial commit'});
  await expect(row).toBeVisible();
  await expect(row.locator('svg circle').first()).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', {name: 'Initial commit', exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('history.png')});
});

test('the minimum desktop window keeps toolbar actions inside the viewport', async ({ page }, info) => {
  await page.setViewportSize({width: 960, height: 640});
  const bounds = await page.getByRole('button', {name: 'Open in browser', exact: true}).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
  await expect(page.getByText('package new', {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('compact.png')});
});

test('settings list categories on the left and save AI credentials', async ({ page }, info) => {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  const nav = dialog.getByRole('navigation', {name: 'Settings'});
  await expect(nav).toBeVisible();
  const navBounds = (await nav.boundingBox())!;
  await expect(dialog.getByRole('button', {name: 'Appearance', exact: true})).toHaveCount(0);
  await dialog.getByRole('button', {name: 'AI', exact: true}).click();
  const address = dialog.getByLabel('API URL', {exact: true});
  await expect(address).toBeVisible();
  const addressBounds = (await address.boundingBox())!;
  expect(addressBounds.x).toBeGreaterThan(navBounds.x + navBounds.width);
  await address.fill('https://api.example.com/v1');
  await dialog.getByLabel('API Key', {exact: true}).fill('sk-test');
  await dialog.getByRole('button', {name: 'Show key', exact: true}).click();
  await expect(dialog.getByLabel('API Key', {exact: true})).toHaveAttribute('type', 'text');
  await page.screenshot({path: info.outputPath('settings-ai.png')});
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AIURL)).toBe('https://api.example.com/v1');
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AIKey)).toBe('sk-test');
});
