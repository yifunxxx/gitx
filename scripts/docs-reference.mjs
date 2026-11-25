import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const ts = require('typescript');
const sourceRoot = path.join(root, 'apps/desktop/src');
const read = p => fs.readFileSync(path.join(sourceRoot, p), 'utf8');
const prop = (object, name) => object.properties?.find(p => p.name?.getText().replaceAll('"', '').replaceAll("'", '') === name)?.initializer;
const str = node => node && ts.isStringLiteral(node) ? node.text : undefined;
const keyMap = {};
const titleAst = ts.createSourceFile('titles.ts', read('actions/titles.ts'), ts.ScriptTarget.Latest, true);
function visitTitles(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText() === 'ACTION_TITLE_KEYS') {
    for (const p of node.initializer.properties) keyMap[p.name.text] = str(p.initializer);
  }
  ts.forEachChild(node, visitTitles);
}
visitTitles(titleAst);
const translations = Object.fromEntries(['zh-CN', 'en'].map(lang => [lang, JSON.parse(read(`i18n/locales/${lang}.json`))]));
const lookup = (lang, key) => key?.split('.').reduce((value, k) => value?.[k], translations[lang]);

// Explicit coverage ownership: new actions fail docs:check until assigned a guide.
export const coverage = {
  'getting-started': ['File.OpenFolder', 'Git.Init', 'Start.Use.Vcs', 'Git.Clone'],
  workspace: ['Git.RefreshStatus', 'ToolWindow.ShowFile', 'ToolWindow.ShowCommit', 'Git.Commit.Tw.Docked', 'Git.Commit.Tw.Window', 'Git.Commit.Tw.Float', 'Git.Commit.ToggleControls', 'Vcs.Operations.Popup'],
  files: ['File.Save'],
  search: ['File.FindInFiles', 'File.GoToFile'],
  commit: ['Git.Add', 'Git.Stage.Add', 'Git.Stage.Reset', 'CheckinProject', 'Git.Commit.And.Push', 'ChangesView.NewChangeList', 'Git.Ignore.File', 'Git.OpenExcludeFile'],
  diff: ['Diff.ShowDiff'],
  branches: ['Git.Branches'],
  sync: ['Git.Configure.Remotes', 'Git.Fetch', 'Git.Pull', 'Git.Push', 'Vcs.UpdateProject', 'Github.Sync.Fork'],
  history: ['Git.ShowHistory', 'Git.Compare.With.Branch', 'Vcs.ShowRepositoryAtRevision', 'Git.Log.CompareWithLocal'],
  conflicts: ['Git.Merge', 'Git.Merge.Abort', 'Git.Merge.Commit', 'Git.Rebase', 'Git.Rebase.Continue', 'Git.Rebase.Skip', 'Git.Rebase.Abort', 'Git.CherryPick', 'Git.CherryPick.Continue', 'Git.CherryPick.Abort', 'Git.ResolveConflicts', 'Git.ChangesView.AcceptYours', 'Git.ChangesView.AcceptTheirs', 'Git.ChangesView.Merge'],
  rewrite: ['Git.Undo.Rewrite', 'Git.Interactive.Rebase', 'Git.Reword.Commit', 'Git.Squash.Commits', 'Git.Drop.Commits', 'Git.Fixup.To.Commit', 'Git.Squash.Into.Commit', 'Git.Uncommit', 'Git.Revert.In.Log', 'Git.Reset.In.Log', 'Git.Revert.Abort', 'Git.InMemory.Extract.Selected.Changes', 'Git.Drop.Selected.Changes'],
  'stash-shelf': ['Git.Stash', 'Git.Show.Stash', 'Git.Shelve'],
  patches: ['Git.Shelf.ImportPatch', 'Create Patch'],
  worktrees: ['Git.Show.WorkingTrees', 'Git.CreateNewWorkingTree', 'Git.Worktrees.OpenRef', 'Git.Submodule.Update'],
  settings: ['Settings'],
};
export function getActions() {
  const actions = [];
  const files = fs.readdirSync(path.join(sourceRoot, 'actions/definitions')).filter(p => p.endsWith('.ts') && !p.endsWith('.test.ts')).map(p => `actions/definitions/${p}`);
  files.push('actions/groups.ts');
  for (const file of files) {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ['registerAction', 'registerGroup'].includes(node.expression.getText())) {
        const obj = node.arguments[0];
        if (ts.isObjectLiteralExpression(obj) && (node.expression.getText() === 'registerAction' || prop(obj, 'popup')?.kind === ts.SyntaxKind.TrueKeyword)) {
          const id = str(prop(obj, 'id'));
          const title = str(prop(obj, 'title')) || id;
          const titleKey = str(prop(obj, 'titleKey')) || keyMap[id];
          const shortcuts = prop(obj, 'defaultShortcuts');
          const bindings = platform => prop(shortcuts ?? {}, platform)?.elements?.map(str) ?? [];
          actions.push({id, en: lookup('en', titleKey) || title, zh: lookup('zh-CN', titleKey) || title, win: bindings('win'), mac: bindings('mac')});
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return actions.sort((a,b) => a.id.localeCompare(b.id));
}
export function getSettingIds() {
  const ast = ts.createSourceFile('schema.ts', read('features/settings/schema.ts'), ts.ScriptTarget.Latest, true);
  const ids=[];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && prop(node, 'control') && prop(node, 'path')) ids.push(str(prop(node, 'id')));
    ts.forEachChild(node, visit);
  }
  visit(ast); return ids;
}
const keyLabel = (chord, mac=false) => chord.split('+').map(key => ({mod:mac?'Cmd':'Ctrl',ctrl:'Ctrl',meta:'Cmd',alt:mac?'Option':'Alt',shift:'Shift',',':',',s:'S',o:'O',p:'P',f:'F',r:'R',a:'A',d:'D',k:'K',t:'T'}[key] || key)).join('+');
const escapeCell = s => s.replaceAll('|','\\|').replaceAll('<','&lt;').replaceAll('>','&gt;');
const guides = [
  ['getting-started','安装、打开、创建、克隆与第一次提交','Install, open, create, clone, and make a first commit'],
  ['workspace','面板、布局、标签、项目切换和命令查找','Panels, layouts, tabs, projects, and Find Action'],
  ['commit','更改列表、暂存、提交、Amend、忽略与回退','Changelists, staging, commits, Amend, ignoring, and rollback'],
  ['diff','双栏/统一差异、行号暂存与比较限制','Side-by-side/unified diffs, line staging, and limits'],
  ['files','文件编辑、批量操作、拖放与路径菜单','File editing, batches, drag-and-drop, and path menus'],
  ['search','已加载过滤、模糊跳转、全局内容搜索','Loaded-tree filtering, fuzzy jumping, and text search'],
  ['branches','分支新建/检出/改名/删除、收藏、比较和标签','Branch creation/checkout/rename/deletion, favorites, comparison, and tags'],
  ['sync','Remote、认证、Fetch/Pull/Push、更新项目和同步 Fork','Remotes, authentication, Fetch/Pull/Push, updates, and fork sync'],
  ['history','Log、筛选、修订比较、文件历史、历史浏览与恢复','Log, filters, comparisons, file history, revision browsing, and restoration'],
  ['conflicts','Merge、Rebase、Cherry-pick、Smart 保存与冲突处理','Merge, Rebase, Cherry-pick, Smart preservation, and conflicts'],
  ['rewrite','交互式变基、Reword、Squash、Drop、Fixup、Reset、Revert、撤销','Interactive rebase, Reword, Squash, Drop, Fixup, Reset, Revert, and undo'],
  ['stash-shelf','Stash/Shelf 创建、应用、预览、删除与恢复','Create, apply, preview, delete, and restore Stash/Shelf records'],
  ['patches','当前变更补丁、Shelf 导出、补丁导入','Local-change patches, Shelf export, and patch import'],
  ['worktrees','Worktree 创建/管理、Ref 审查、多仓库与子模块','Worktree creation/management, ref review, multiple roots, and submodules'],
  ['terminal','真实终端、会话、Console 和后台队列','Interactive terminals, sessions, Console, and background jobs'],
  ['settings','所有设置字段、外观、语言、快捷键和软件更新','Every settings field, appearance, language, keymap, and app updates'],
];
export function renderReferences() {
  const actions = getActions();
  const ownership = new Map(Object.entries(coverage).flatMap(([page, ids])=>ids.map(id=>[id,page])));
  const out = new Map();
  for (const en of [false,true]) {
    const folder = en ? 'en/guide' : 'guide';
    const title = en ? 'Feature index' : '完整功能索引';
    let text = `# ${title}\n\n${en ? 'This index connects the current desktop UI to task-oriented guides. Registered commands are checked against the source when documentation builds. Context menus and panel controls are covered in the chapter list as well.' : '本索引按当前桌面界面组织操作指南。构建时会核对源码中已注册的命令，减少新增功能后文档遗漏；各面板按钮与右键菜单也纳入对应章节。'}\n\n`;
    text += `## ${en?'Browse by task':'按任务查找'}\n\n| ${en?'Task':'功能范围'} | ${en?'Guide':'操作指南'} |\n| --- | --- |\n`;
    for (const [slug,zh,english] of guides) text += `| ${en?english:zh} | [${en?'Read guide':'查看步骤'}](./${slug}) |\n`;
    text += `\n## ${en?'Registered commands':'已注册命令'}\n\n${en?'Use Find Action (`Ctrl+Shift+A`) to search. Availability depends on repository state and selection. A blank default binding does not mean the feature is unavailable.':'用查找动作（`Ctrl+Shift+A`）搜索名称。是否可执行取决于仓库状态和当前选择；没有默认快捷键不代表功能不可用。'}\n\n| ${en?'Command':'命令'} | ${en?'Windows default':'Windows 默认键'} | ${en?'Guide':'说明'} |\n| --- | --- | --- |\n`;
    for(const action of actions) text += `| ${escapeCell(en?action.en:action.zh)} | ${action.win.map(c=>'`'+keyLabel(c)+'`').join(' / ')||'—'} | [${en?'Steps':'使用方式'}](./${ownership.get(action.id)||'MISSING'}) |\n`;
    text += `\n## ${en?'Current UI boundaries':'当前界面边界'}\n\n${en ? 'Per-hunk Stage/Unstage/Rollback controls are available in ordinary live file diffs; see the Diff guide for supported comparisons and preview checks. Changelist HEAD-to-Local diffs also offer block assignment; see the Commit guide for selection and safety boundaries. Dedicated submodule registration, hosting-account management, PR Review, and platform MR tools are also outside this UI. Windows is the documented installer and screenshot platform; key definitions for other platforms do not establish published native packages.' : '普通本地文件 Diff 已提供逐块 Stage/Unstage/Rollback 按钮，支持范围及预览核对见差异教程。Changelist 的 HEAD→Local 差异支持按块归属，选择规则及限制见提交教程。专门的子模块注册、托管平台账号管理、PR Review 与 MR 工具也不属于当前界面。安装包与截图以 Windows 为准，存在其他平台快捷键定义不代表已有对应原生发行包。'}\n`;
    out.set(`${folder}/features.md`,text);
    let keys=`# ${en?'Keyboard shortcuts':'快捷键速查'}\n\n${en?'The table is generated from the registered default bindings. Windows/Linux use Ctrl for Mod; macOS uses Cmd where defined. These definitions do not imply that native installers are published for every platform. Custom Keymap settings override the defaults.':'下表从动作注册中的默认绑定生成。Windows/Linux 的 Mod 为 Ctrl，macOS 按定义使用 Cmd；快捷键定义不代表每个平台都已提供安装包。自定义 Keymap 会覆盖默认键。'}\n\n| ${en?'Action':'动作'} | Windows | macOS |\n| --- | --- | --- |\n`;
    for(const action of actions.filter(a=>a.win.length||a.mac.length)) keys+=`| [${escapeCell(en?action.en:action.zh)}](./${ownership.get(action.id)}) | ${action.win.map(c=>'`'+keyLabel(c)+'`').join(' / ')||'—'} | ${action.mac.map(c=>'`'+keyLabel(c,true)+'`').join(' / ')||'—'} |\n`;
    keys+=`\n## ${en?'Fixed and context-specific keys':'固定与上下文按键'}\n\n| ${en?'Context':'位置'} | ${en?'Keys':'按键'} | ${en?'Result':'用途'} |\n| --- | --- | --- |\n`;
    const rows=en?[
      ['Global','Ctrl+Shift+A / Cmd+Shift+A','Find Action'],['Global','Ctrl+backtick / Cmd+backtick','Toggle Terminal'],['Changes','F4','Open working-file editor'],['File','Enter / double-click','Open file editor; expand a directory'],['File','F4','Open an applicable Git diff'],['File','F2 / Delete','Rename / recycle selected item(s)'],['Trees/lists','Arrows, Home/End, PageUp/PageDown','Navigate; Left/Right collapse/expand'],['Changes','Space','Toggle commit checkbox'],['Supported lists','Shift+F10','Open context menu'],['Merge editor','F7 / Shift+F7','Next / previous conflict'],['Editable text','Ctrl+Z / Ctrl+Shift+Z','Undo / redo (Cmd on macOS)'],['Terminal','Ctrl+Shift+C / Ctrl+Shift+V','Copy selection / paste'],['Menus/dialogs','Escape','Close or cancel when available; busy operations may retain the dialog'],
    ]:[
      ['全局','Ctrl+Shift+A / Cmd+Shift+A','查找动作'],['全局','Ctrl+反引号 / Cmd+反引号','切换终端'],['Changes','F4','打开工作文件编辑器'],['File','Enter / 双击','编辑文件或展开目录'],['File','F4','打开适用 Git Diff'],['File','F2 / Delete','重命名 / 移入回收站'],['树/列表','方向键、Home/End、PageUp/PageDown','导航；左右展开/折叠'],['Changes','空格','切换提交复选框'],['支持的列表','Shift+F10','右键菜单'],['合并编辑器','F7 / Shift+F7','下一处 / 上一处冲突'],['可编辑文本','Ctrl+Z / Ctrl+Shift+Z','撤销 / 重做（macOS 使用 Cmd）'],['终端','Ctrl+Shift+C / Ctrl+Shift+V','复制选择 / 粘贴'],['菜单/对话框','Esc','允许时关闭或取消；执行中可能保持窗口'],
    ];
    for(const row of rows)keys+=`| ${row.join(' | ')} |\n`;
    keys+=`\n${en?'Focus matters: F2 in Log edits a commit message, while F2 in File renames a file. Close modal input dialogs before invoking global commands. To rebind, open [Settings → Keymap](./settings), record a combination, resolve conflicts, and Apply.':'焦点会改变按键含义：Log 中 F2 编辑提交说明，File 中 F2 改文件名。输入弹窗打开时先处理弹窗，再执行全局动作。自定义绑定请到[Settings → Keymap](./settings)，记录组合、解决冲突后 Apply。'}\n`;
    out.set(`${folder}/shortcuts.md`,keys);
  }
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, text] of renderReferences()) fs.writeFileSync(path.join(root,'docs/site',name),text);
  console.log(`Generated bilingual feature and shortcut references (${getActions().length} commands).`);
}
