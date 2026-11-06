import { expect, test } from "@playwright/test"

const mockAPI = `
import { createBackend } from '/tests/backend.ts';
const backend = createBackend();
window.__mygitTestBackend = backend;
const proxy = (name) => new Proxy({}, {get: (_, method) => (...args) => backend.call(name+'.'+String(method), ...args)});
export const Workspace = proxy('WorkspaceService'), Git = proxy('RepositoryService'), Desktop = proxy('DesktopService'), Term = proxy('TerminalService'), AI = proxy('AIService'), Lifecycle = proxy('AppService');
export function action(Kind, Path, values={}) {return {Kind,Path,Ref:'',Name:'',Value:'',Message:'',Remote:'',Files:[],Area:0,Confirm:false,Force:false,Keep:true,Untracked:true,NoCommit:false,Rebase:false,Autostash:false,UpdateRefs:false,Track:false,Tags:false,Parent:0,Mode:'',Plan:[],...values}}
export function changeRequest(Path,Mode='changes',Revision='',extra={}) {return {Path,Mode,Revision,From:'',To:'',File:'',...extra}}
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/src/lib/api.ts', route => route.fulfill({ contentType: 'application/javascript', body: mockAPI }));
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Stage all', exact: true})).toBeVisible();
});

test('terminal badge on the project row expands its terminal list', async ({ page }, info) => {
  const row = page.locator('.nav-project').filter({ hasText: 'alpha' }).first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Show terminals (1)', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Terminal: alpha', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.screenshot({ path: info.outputPath('terminal-badge.png') });
});

test('terminal sidebar adds and runs shortcut commands', async ({ page }, info) => {
  await page.getByRole('button', {name: 'Terminal', exact: true}).first().click();
  const sidebar = page.getByRole('complementary', {name: 'Terminal commands', exact: true});
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('No commands yet. Add one with +.')).toBeVisible();
  await sidebar.getByRole('button', {name: 'New command', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Command name', {exact: true}).fill('Dev server');
  await dialog.getByLabel('Command', {exact: true}).fill('npm run dev');
  await dialog.getByRole('combobox', {name: 'Terminal type', exact: true}).click();
  await expect(page.getByRole('option', {name: /Git Bash/})).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('option', {name: 'Command Prompt', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(dialog).toBeHidden();
  const entry = sidebar.getByRole('button', {name: /Dev server/});
  await expect(entry).toContainText('npm run dev');
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.terminalCommands)).toEqual([{ID: 'cmd-1', Label: 'Dev server', Command: 'npm run dev', Profile: 'cmd', Path: 'C:/Projects/alpha'}]);
  await entry.click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.terminalShells)).toEqual(['', 'cmd']);
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.terminalWrites)).toEqual(['npm run dev\r']);
  await expect(page.getByRole('button', {name: 'Dev server — Command Prompt', exact: true})).toBeVisible();
  // Ctrl+W closes the active terminal tab.
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('button', {name: 'Dev server — Command Prompt', exact: true})).toHaveCount(0);
  await page.screenshot({path: info.outputPath('terminal-commands.png')});
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
  await dialog.getByRole('button', {name: 'Fetch models', exact: true}).click();
  await expect(dialog.getByText('2 models available', {exact: true})).toBeVisible();
  await dialog.getByRole('combobox', {name: 'Model', exact: true}).click();
  await page.getByRole('option', {name: 'deepseek-chat', exact: true}).click();
  await dialog.getByLabel('Commit message prompt', {exact: true}).fill('Write in Chinese.');
  await dialog.getByText('Show the built-in prompt', {exact: true}).click();
  await expect(dialog.getByText('You write commit messages for a Git repository.')).toBeVisible();
  await page.screenshot({path: info.outputPath('settings-ai.png')});
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AIURL)).toBe('https://api.example.com/v1');
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AIKey)).toBe('sk-test');
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AIModel)).toBe('deepseek-chat');
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.state.Preferences.AICommitPrompt)).toBe('Write in Chinese.');
});

test('writes a commit message from the staged changes', async ({ page }) => {
  const box = page.getByRole('textbox', {name: 'Commit message', exact: true});
  await expect(box).toBeVisible();
  await page.getByRole('button', {name: 'Generate commit message', exact: true}).click();
  await expect(box).toHaveValue('feat: describe the staged changes');
});

test('settings open the local data location', async ({ page }) => {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name: 'Folders', exact: true}).click();
  await expect(dialog.getByText('C:/Users/test/.mygit-wails3', {exact: true})).toBeVisible();
  await dialog.getByRole('button', {name: 'Open data location', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.opened)).toEqual(['C:/Users/test/.mygit-wails3']);
});

test('settings dialog keeps a fixed height when switching sections', async ({ page }) => {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  // offsetHeight is the layout height, unaffected by the open/zoom animation.
  const height = () => dialog.evaluate((el) => (el as HTMLElement).offsetHeight);
  const general = await height();
  await dialog.getByRole('button', {name: 'About', exact: true}).click();
  await expect(dialog.getByText('v0.2.0', {exact: true})).toBeVisible();
  expect(await height()).toBe(general);
  await dialog.getByRole('button', {name: 'AI', exact: true}).click();
  expect(await height()).toBe(general);
});

test('settings dialog drops the subtitle and update note, and aligns its fields', async ({ page }) => {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  // The dialog title no longer has a "MyGit" description line under it.
  await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveCount(0);
  await dialog.getByRole('button', {name: 'About', exact: true}).click();
  await expect(
    dialog.getByText('The update downloads and installs inside MyGit.'),
  ).toHaveCount(0);
  // The AI fields share one right edge even where a trailing action button sits.
  await dialog.getByRole('button', {name: 'AI', exact: true}).click();
  const apiUrl = (await dialog.getByLabel('API URL', {exact: true}).boundingBox())!;
  const apiKey = (await dialog.getByLabel('API Key', {exact: true}).boundingBox())!;
  const model = (await dialog.getByLabel('Model', {exact: true}).boundingBox())!;
  const right = apiUrl.x + apiUrl.width;
  expect(Math.abs(apiKey.x + apiKey.width - right)).toBeLessThanOrEqual(1);
  expect(Math.abs(model.x + model.width - right)).toBeLessThanOrEqual(1);
});
