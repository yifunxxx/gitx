import { defineConfig } from 'vitepress'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
const editBranch = process.env.DOCS_BRANCH || 'codex/docs-site'
const chapters = [
  ['getting-started', '安装与第一次提交', 'Installation & first commit'],
  ['workspace', '工作区与界面导航', 'Workspace & navigation'],
  ['commit', '提交与更改列表', 'Commits & changelists'],
  ['diff', '差异与部分暂存', 'Diff & partial staging'],
  ['files', '文件管理与编辑', 'Files & editing'],
  ['search', '文件跳转与内容搜索', 'File & text search'],
  ['branches', '分支与标签', 'Branches & tags'],
  ['sync', '远程仓库与同步', 'Remotes & synchronization'],
  ['history', '日志、历史与比较', 'Log, history & comparisons'],
  ['conflicts', '合并、变基与冲突', 'Merge, rebase & conflicts'],
  ['rewrite', '整理与撤销历史', 'Rewriting & undoing history'],
  ['stash-shelf', 'Stash 与 Shelf', 'Stash & Shelf'],
  ['patches', '补丁导入与导出', 'Importing & exporting patches'],
  ['worktrees', 'Worktree、多仓库与子模块', 'Worktrees, roots & submodules'],
  ['terminal', '终端、控制台与任务', 'Terminal, console & jobs'],
  ['settings', '设置、主题与更新', 'Settings, themes & updates'],
  ['shortcuts', '快捷键速查', 'Keyboard shortcuts'],
  ['troubleshooting', '常见问题与恢复', 'Troubleshooting & recovery'],
  ['glossary', 'Git 术语表', 'Git glossary'],
  ['features', '完整功能索引', 'Feature index'],
  ['publishing', '维护与部署文档', 'Maintaining & deploying docs'],
] as const
function sidebar(en = false) {
  const prefix = en ? '/en' : ''
  const entries = (start: number, end: number) => chapters.slice(start, end).map(([slug, zh, english]) => ({ text: en ? english : zh, link: `${prefix}/guide/${slug}` }))
  return [
    { text: en ? 'Start here' : '开始使用', items: entries(0, 2) },
    { text: en ? 'Daily workflow' : '日常工作', items: entries(2, 9) },
    { text: en ? 'Advanced workflows' : '进阶操作', collapsed: false, items: entries(9, 15) },
    { text: en ? 'Reference & help' : '参考与帮助', items: entries(15, 21) },
  ]
}
export default defineConfig({
  title: 'gitx',
  description: 'gitx 中英文使用手册 — 桌面 Git 工作台的完整操作指南',
  base: process.env.DOCS_BASE || '/gitx/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://yifunxxx.github.io/gitx/' },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${process.env.DOCS_BASE || '/gitx/'}logo.svg` }]],
  locales: {
    root: {
      label: '简体中文', lang: 'zh-CN', title: 'gitx 使用手册',
      themeConfig: {
        nav: [{ text: '使用指南', link: '/guide/getting-started' }, { text: '功能索引', link: '/guide/features' }, { text: `v${version}`, link: 'https://github.com/yifunxxx/gitx/releases/latest' }],
        sidebar: sidebar(),
        outline: { label: '本页目录', level: [2, 3] },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
        editLink: { pattern: `https://github.com/yifunxxx/gitx/edit/${editBranch}/docs/site/:path`, text: '在 GitHub 上编辑此页' },
        darkModeSwitchLabel: '主题', lightModeSwitchTitle: '切换到浅色', darkModeSwitchTitle: '切换到深色',
        sidebarMenuLabel: '目录', returnToTopLabel: '回到顶部', langMenuLabel: '切换语言',
        footer: { message: '基于 MIT 许可发布 · 文档与软件共同维护', copyright: 'gitx' },
      },
    },
    en: {
      label: 'English', lang: 'en', title: 'gitx User Guide', description: 'A practical guide to every feature in the gitx desktop Git workbench.',
      themeConfig: {
        nav: [{ text: 'Guide', link: '/en/guide/getting-started' }, { text: 'Feature index', link: '/en/guide/features' }, { text: `v${version}`, link: 'https://github.com/yifunxxx/gitx/releases/latest' }],
        sidebar: sidebar(true), outline: { level: [2, 3] },
        editLink: { pattern: `https://github.com/yifunxxx/gitx/edit/${editBranch}/docs/site/:path`, text: 'Edit this page on GitHub' },
        footer: { message: 'Released under the MIT License · Maintained with the app', copyright: 'gitx' },
      },
    },
  },
  themeConfig: {
    logo: '/logo.svg', siteTitle: 'gitx',
    socialLinks: [{ icon: 'github', link: 'https://github.com/yifunxxx/gitx' }],
    search: { provider: 'local', options: {
      miniSearch: { options: {
        // Keep this self-contained: VitePress serializes it for browser queries.
        tokenize: (text: string) => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
          .filter(part => part.isWordLike).map(part => part.segment),
      } },
      locales: { root: { translations: {
      button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
      modal: { displayDetails: '显示详细列表', resetButtonTitle: '清空搜索', backButtonTitle: '返回', noResultsText: '没有找到相关结果', footer: { selectText: '选择', selectKeyAriaLabel: '回车', navigateText: '切换', navigateUpKeyAriaLabel: '上', navigateDownKeyAriaLabel: '下', closeText: '关闭', closeKeyAriaLabel: 'Escape' } },
    } } } } },
  },
})
