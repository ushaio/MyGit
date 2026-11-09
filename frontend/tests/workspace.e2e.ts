import { expect, test } from "@playwright/test"

const mockAPI = `
import { createBackend } from '/tests/backend.ts';
const backend = createBackend();
window.__mygitTestBackend = backend;
const proxy = (name) => new Proxy({}, {get: (_, method) => (...args) => backend.call(name+'.'+String(method), ...args)});
export const Workspace = proxy('WorkspaceService'), Git = proxy('RepositoryService'), Desktop = proxy('DesktopService'), Term = proxy('TerminalService'), AI = proxy('AIService'), Lifecycle = proxy('AppService'), Workflow = proxy('WorkflowService');
export function action(Kind, Path, values={}) {return {Kind,Path,Ref:'',Name:'',Value:'',Message:'',Remote:'',Files:[],Area:0,Confirm:false,Force:false,Keep:true,Untracked:true,NoCommit:false,Rebase:false,Autostash:false,UpdateRefs:false,Track:false,Tags:false,Parent:0,Mode:'',Plan:[],...values}}
export function changeRequest(Path,Mode='changes',Revision='',extra={}) {return {Path,Mode,Revision,From:'',To:'',File:'',...extra}}
`;

test.beforeEach(async ({ page }) => {
  await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/javascript', body: mockAPI }));
  await page.goto('/');
  // The development-only feedback widget floats over the bottom-right controls.
  await page.addStyleTag({content: '[data-agentation-portal] { display: none !important; }'});
  await expect(page.getByRole('button', {name: 'Stage all', exact: true})).toBeVisible();
});

test('terminal badge on the project row expands its terminal list', async ({ page }, info) => {
  await page.getByRole('button', {name: 'Pinned 1', exact: true}).click();
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

test('project split button selects and launches all open methods', async ({ page }, info) => {
  const chooser = page.getByRole('button', {name: 'Choose how to open project', exact: true});
  await chooser.click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page.getByRole('menuitem', {name: 'Open in browser', exact: true}).click();
  await page.getByRole('button', {name: 'Open in browser', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.openedUrls)).toEqual(['https://github.com/example/alpha']);
  await chooser.click();
  await page.getByRole('menuitem', {name: 'Open in File Explorer', exact: true}).click();
  await page.getByRole('button', {name: 'Open in File Explorer', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.opened)).toEqual(['C:/Projects/alpha']);
  for (const [label, tool] of [['Open in terminal', 'terminal'], ['Open in VS Code', 'code']]) {
    await chooser.click();
    await page.getByRole('menuitem', {name: label, exact: true}).click();
    await page.getByRole('button', {name: label, exact: true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.openedTools)).toContainEqual(['C:/Projects/alpha', tool]);
  }
  await page.evaluate(() => { (window as any).__mygitTestBackend.toolAvailability.code = false; });
  await chooser.click();
  await expect(page.getByRole('menuitem', {name: 'Open in VS Code (Not installed)', exact: true})).toHaveAttribute('aria-disabled', 'true');
  await page.screenshot({path: info.outputPath('project-tools.png')});
});

test('global terminal list groups projects, switches and closes sessions', async ({ page }, info) => {
  await page.setViewportSize({width: 1306, height: 803});
  const switcher = page.getByRole('button', {name: 'Open terminals', exact: true});
  await expect(switcher).toHaveText('0 open terminals');
  const changes = page.locator('footer').getByText('1 Changes', {exact: true});
  await expect(changes.locator('svg')).toBeVisible();
  const terminalBounds = await switcher.boundingBox();
  const changeBounds = await changes.boundingBox();
  expect(terminalBounds!.x + terminalBounds!.width).toBeLessThan(changeBounds!.x);
  await switcher.click();
  await expect(page.getByText('No open terminals', {exact: true})).toBeVisible();
  await expect(page.getByRole('searchbox', {name: 'Search terminals', exact: true})).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Pinned 1', exact: true}).click();
  await page.getByRole('button', {name: 'Ungrouped projects', exact: true}).click();
  for (const name of ['alpha', 'beta']) {
    await page.locator('.nav-project').filter({hasText: name}).first().click({button: 'right'});
    await page.getByRole('menuitem', {name: 'New terminal', exact: true}).click();
    await expect(switcher).toHaveText(name === 'alpha' ? '1 open terminal' : '2 open terminals');
  }
  await switcher.click();
  const popup = page.getByRole('dialog', {name: 'Open terminals', exact: true});
  const search = popup.getByRole('searchbox', {name: 'Search terminals', exact: true});
  await expect(search).toBeFocused();
  await expect(popup.locator('section')).toHaveCount(2);
  await search.fill(' BETA ');
  await expect(popup.locator('section')).toHaveCount(1);
  await expect(popup.getByRole('button', {name: 'Switch to terminal: beta', exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('terminal-search.png')});
  // A path matching an open terminal must not match its command name.
  await search.fill('C:/Projects/alpha');
  await expect(popup.getByRole('status')).toHaveText('No matching terminals');
  await expect(popup.locator('section')).toHaveCount(0);
  await search.fill('no-such-terminal');
  await expect(popup.getByRole('status')).toHaveText('No matching terminals');
  await expect(popup.locator('section')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await switcher.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(popup.locator('section')).toHaveCount(2);
  await search.fill('alpha');
  await popup.getByRole('button', {name: 'Switch to terminal: alpha', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.state.Selected)).toBe('C:/Projects/alpha');
  await expect(page.getByRole('button', {name: 'alpha — Windows PowerShell', exact: true})).toBeVisible();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('button', {name: 'Switch to terminal: alpha', exact: true})).toHaveAttribute('aria-current', 'true');
  await expect(search).toHaveValue('alpha');
  await search.fill('');
  const beta = popup.getByRole('button', {name: 'Switch to terminal: beta', exact: true});
  await beta.click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.state.Selected)).toBe('C:/Projects/beta');
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await expect(popup).toBeVisible();
  await expect(beta).toHaveAttribute('aria-current', 'true');
  await popup.getByRole('button', {name: 'Switch to terminal: alpha', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.state.Selected)).toBe('C:/Projects/alpha');
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await expect(popup).toBeVisible();
  await beta.hover();
  await page.screenshot({path: info.outputPath('terminal-switcher.png')});
  await popup.getByRole('button', {name: 'Close terminal: beta', exact: true}).click();
  await expect(popup.getByRole('button', {name: 'Confirm close terminal: beta', exact: true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mygitTestBackend.closedTerminals)).toEqual([]);
  await page.screenshot({path: info.outputPath('terminal-close-confirm.png')});
  // Dismissing and reopening must cancel an armed close button.
  await page.keyboard.press('Escape');
  await switcher.click();
  await popup.getByRole('button', {name: 'Close terminal: beta', exact: true}).click();
  await popup.getByRole('button', {name: 'Confirm close terminal: beta', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.closedTerminals)).toEqual(['term-2']);
  await expect(popup.locator('section')).toHaveCount(1);
  await expect(switcher).toHaveText('1 open terminal');
  // Closing the current session also clears the list without navigating away.
  await popup.getByRole('button', {name: 'Close terminal: alpha', exact: true}).click();
  await popup.getByRole('button', {name: 'Confirm close terminal: alpha', exact: true}).click();
  await expect(page.getByText('No open terminals', {exact: true})).toBeVisible();
  await page.locator('footer').getByText('C:/Projects/alpha', {exact: true}).click();
  await expect(popup).toBeHidden();
});

test('shortcut dialog offers installed WSL and runs its profile', async ({ page }) => {
  await page.getByRole('button', {name: 'Terminal', exact: true}).first().click();
  const sidebar = page.getByRole('complementary', {name: 'Terminal commands', exact: true});
  await sidebar.getByRole('button', {name: 'New command', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Command name', {exact: true}).fill('Linux status');
  await dialog.getByLabel('Command', {exact: true}).fill('git status');
  await dialog.getByRole('combobox', {name: 'Terminal type', exact: true}).click();
  await page.getByRole('option', {name: 'WSL', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await sidebar.getByRole('button', {name: /Linux status/}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.terminalShells)).toEqual(['', 'wsl']);
  await expect.poll(() => page.evaluate(() => (window as any).__mygitTestBackend.terminalWrites)).toEqual(['git status\r']);
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
  const bounds = await page.getByRole('button', {name: 'Choose how to open project', exact: true}).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
  await expect(page.getByText('package new', {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('compact.png')});
});

test('workflow bar lists scripts and opens run history in the main view', async ({ page }, info) => {
  await page.setViewportSize({width: 1306, height: 803});
  // Seed a GitHub token so the workflow list renders.
  await page.evaluate(() =>
    (window as any).__mygitTestBackend.call(
      'WorkflowService.SaveToken',
      {Platform: 'github', Host: 'github.com'},
      'ghp_test',
    ),
  );
  const bar = page.locator('section[aria-label="Workflows"]');
  await expect(bar).toBeVisible();
  const toggle = bar.locator('button[aria-expanded]').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Expanding must not move the header (no layout jitter from scrollbar/height).
  const before = await toggle.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const after = await toggle.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  // Refresh re-reads the freshly configured account and lists workflows.
  await bar.getByRole('button', {name: 'Refresh', exact: true}).click();
  await expect(bar.getByText('All workflows', {exact: true})).toBeVisible();
  const ci = bar.getByRole('button', {name: /CI/}).first();
  await expect(ci).toBeVisible();
  // Selecting a script shows its runs in the main content (commit-log style).
  await ci.click();
  await expect(page.getByRole('button', {name: 'Run workflow', exact: true})).toBeVisible();
  await expect(page.getByText('Update main', {exact: true}).first()).toBeVisible();
  await expect(page.getByText('#7', {exact: true}).first()).toBeVisible();
  // A run reveals its jobs without selecting one; selecting a job opens a sibling detail pane.
  const runRow = page.getByRole('button', {name: 'Run #7'});
  await page.evaluate(() => {
    const state = window as any;
    const backend = state.__mygitTestBackend;
    const original = backend.call;
    const ready = new Promise<void>(resolve => { state.releaseWorkflowGraph = resolve; });
    backend.call = async (name: string, ...args: unknown[]) => {
      if (name === 'WorkflowService.Graph') await ready;
      return original(name, ...args);
    };
    state.workflowPaints = [];
    const sample = () => {
      const nodes = document.querySelectorAll('[data-workflow-node]');
      if (nodes.length) state.workflowPaints.push({
        nodes: nodes.length,
        edges: document.querySelectorAll('[data-workflow-edge]').length,
        transform: (document.querySelector('[data-workflow-graph-content]') as HTMLElement).style.transform,
      });
      state.workflowPaintFrame = requestAnimationFrame(sample);
    };
    state.workflowPaintFrame = requestAnimationFrame(sample);
  });
  await runRow.click();
  const loadingCanvas = page.getByRole('region', {name: 'Job canvas', exact: true});
  await expect(loadingCanvas).toHaveAttribute('aria-busy', 'true');
  await expect(loadingCanvas.getByRole('status')).toHaveText('Loading dependencies…');
  await expect(loadingCanvas.locator('[data-workflow-node]')).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseWorkflowGraph());
  await expect(page.getByText('push', {exact: true})).toBeVisible();
  const job = page.getByRole('button', {name: /Build & Package \(windows\)/});
  await expect(job).toHaveAttribute('aria-pressed', 'false');
  const graph = page.getByRole('region', {name: 'Workflow graph', exact: true});
  await expect(graph.locator('[data-workflow-edge]')).toHaveCount(1);
  const buildBounds = await graph.locator('[data-workflow-node="definition:build"]').boundingBox();
  const publishBounds = await graph.locator('[data-workflow-node="definition:publish"]').boundingBox();
  expect(buildBounds!.x + buildBounds!.width).toBeLessThan(publishBounds!.x);
  const content = graph.locator('[data-workflow-graph-content]');
  const fitted = await content.getAttribute('style');
  const paints = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const state = window as any;
    cancelAnimationFrame(state.workflowPaintFrame);
    return state.workflowPaints as {nodes: number; edges: number; transform: string}[];
  });
  expect(paints.length).toBeGreaterThan(0);
  expect(paints.every(paint => paint.nodes === 2 && paint.edges === 1)).toBe(true);
  expect(new Set(paints.map(paint => paint.transform)).size).toBe(1);
  await graph.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await expect(content).not.toHaveAttribute('style', fitted!);
  await graph.getByRole('button', {name: 'Fit to view', exact: true}).click();
  await expect(content).toHaveAttribute('style', fitted!);
  const canvas = graph.getByRole('region', {name: 'Job canvas', exact: true});
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds!.x + 10, bounds!.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 70, bounds!.y + 40, {steps: 5});
  await page.mouse.up();
  await expect(content).not.toHaveAttribute('style', fitted!);
  await canvas.focus();
  await page.keyboard.press('0');
  await expect(content).toHaveAttribute('style', fitted!);
  await page.screenshot({path: info.outputPath('workflow-canvas.png')});
  const detail = page.getByRole('complementary', {name: 'Jobs: Build & Package (windows)'});
  await expect(detail).toHaveCount(0);
  await job.click();
  await expect(detail).toBeVisible();
  await expect.poll(async () => {
    const canvasBox = await canvas.boundingBox();
    const nodes = await graph.locator('[data-workflow-node]').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
    }));
    return nodes.every((node) => node.left >= canvasBox!.x - 1 && node.right <= canvasBox!.x + canvasBox!.width + 1 && node.top >= canvasBox!.y - 1 && node.bottom <= canvasBox!.y + canvasBox!.height + 1);
  }).toBe(true);
  await page.screenshot({path: info.outputPath('workflow-canvas-details.png')});
  const step = detail.getByRole('button', {name: /Set up job/});
  await expect(step).toHaveAttribute('aria-expanded', 'false');
  await step.click();
  const logs = detail.getByRole('region', {name: 'Step logs'});
  await expect(logs.getByText("Current runner version: '2.338.2'", {exact: true})).toBeVisible();
  const group = logs.getByText('Operating System', {exact: true});
  await expect(logs.getByText('Microsoft Windows Server 2025', {exact: true})).toBeHidden();
  await group.click();
  await expect(logs.getByText('Microsoft Windows Server 2025', {exact: true})).toBeVisible();
  await step.click();
  await expect(logs).toHaveCount(0);
  await detail.getByRole('button', {name: 'Close', exact: true}).click();
  await expect(detail).toHaveCount(0);
  await expect(job).toHaveAttribute('aria-pressed', 'false');
  await expect(runRow).toHaveAttribute('aria-expanded', 'true');
  // Rerun asks for confirmation first.
  await page.getByRole('button', {name: 'Rerun', exact: true}).click();
  await expect(page.getByText('Rerun this run?', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Confirm', exact: true}).click();
  await expect(page.getByText('Rerun this run?', {exact: true})).toBeHidden();
  // Cancel (in-progress run) also asks for confirmation.
  await page.getByRole('button', {name: 'Cancel', exact: true}).first().click();
  await expect(page.getByText('Cancel this run?', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Cancel this run?', {exact: true})).toBeHidden();
  // Run opens a complete form; no request is dispatched until the user submits it.
  await page.evaluate(() => {
    const state = window as any;
    const original = state.__mygitTestBackend.call;
    state.workflowDispatches = [];
    state.__mygitTestBackend.call = async (name: string, ...args: unknown[]) => {
      if (name === 'WorkflowService.Inputs') return [
        {Name: 'mode', Description: '运行模式：verify=只验证打包不发版；release=构建并发布 Release', Type: 'choice', Options: ['verify', 'release'], Default: 'verify', Required: false},
        {Name: 'version', Description: '发版版本号（仅 mode=release 时使用，不含前导 v），须与 CHANGELOG 中的 [版本] 一致', Type: 'string', Options: [], Default: '', Required: false},
        {Name: 'dry_run', Description: '仅演练，不发布产物', Type: 'boolean', Options: [], Default: 'false', Required: false},
      ];
      if (name === 'WorkflowService.Dispatch') { state.workflowDispatches.push(args); return; }
      return original(name, ...args);
    };
  });
  await page.getByRole('button', {name: 'Run workflow', exact: true}).click();
  const runForm = page.getByRole('dialog', {name: 'Run workflow', exact: true});
  await expect(runForm.getByRole('combobox', {name: 'Ref', exact: true})).toHaveText(/main/);
  await expect(runForm.getByRole('combobox', {name: 'mode', exact: true})).toHaveText('verify');
  expect(await page.evaluate(() => (window as any).workflowDispatches)).toHaveLength(0);
  await runForm.getByRole('combobox', {name: 'mode', exact: true}).click();
  await page.getByRole('option', {name: 'release', exact: true}).click();
  await runForm.getByRole('textbox', {name: 'version', exact: true}).fill('0.3.2');
  await runForm.getByRole('checkbox', {name: 'dry_run', exact: true}).check();
  await expect(runForm).toBeVisible();
  const formBounds = await runForm.boundingBox();
  expect(formBounds!.x).toBeGreaterThanOrEqual(0);
  expect(formBounds!.y + formBounds!.height).toBeLessThanOrEqual(803);
  await page.screenshot({path: info.outputPath('workflow-inputs.png')});
  await runForm.getByRole('button', {name: 'Start run', exact: true}).click();
  await expect(runForm).toHaveCount(0);
  const dispatched = await page.evaluate(() => (window as any).workflowDispatches);
  expect(dispatched).toHaveLength(1);
  expect(dispatched[0][1]).toBe(101);
  expect(dispatched[0][2]).toBe('main');
  expect(dispatched[0][3].map((input: {Name: string; Default: string}) => [input.Name, input.Default])).toEqual([
    ['mode', 'release'], ['version', '0.3.2'], ['dry_run', 'true'],
  ]);
  await page.getByRole('button', {name: 'Run workflow', exact: true}).click();
  await expect(runForm.getByRole('combobox', {name: 'mode', exact: true})).toHaveText('verify');
  await page.keyboard.press('Escape');
  await expect(runForm).toHaveCount(0);
  await page.screenshot({path: info.outputPath('workflows.png')});
});

test('settings workflow section links to a prefilled GitHub token page', async ({ page }, info) => {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name: 'Workflows', exact: true}).click();
  const link = dialog.getByRole('button', {name: 'Create token on GitHub', exact: true});
  await expect(link).toBeVisible();
  await link.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__mygitTestBackend.openedUrls))
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining('settings/tokens/new?scopes=repo,workflow'),
      ]),
    );
  await page.screenshot({path: info.outputPath('settings-workflows.png')});
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
  await expect(dialog.getByText(/^v\d+\.\d+\.\d+$/).first()).toBeVisible();
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
