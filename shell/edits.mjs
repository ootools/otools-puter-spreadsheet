/**
 * 逐条外科手术式改动（1~5 行的局部修改）。
 * ------------------------------------------------------------------
 * 每一条都必须能命中：`expect` 是硬约束。上游改了那段代码，构建会报
 * 「命中 N 次，期望 M 次」并打印是哪一条、为什么改。**不要为了让构建过而
 * 放宽 expect**，要去读上游的新代码，把 find/replace 更新到新的形状。
 *
 * 超过 5 行、或者涉及结构性改动，就别放这里——走 shell/overlay/ 整文件替换
 * （本项目的 `src/lib/puter.js` 就是这么换掉的）。
 *
 * 这批改动的主题只有一个：**把界面里残留的「Puter 云」文案改成「本机」**。
 *
 * 需要 Puter 登录的功能（登录、登出、云端分享、实时协作、云端 AI）在 seam
 * 层已全部关掉：`isApp()` 恒为 true、`signedOut` 恒为 false，于是 `appmenu.js`
 * 的「Sign in / Sign out」分支与 `home.js` 的「Sign in to Puter」整块都不会
 * 渲染；`canShare()` / `canAI()` 返回 false，分享与 AI 面板自动隐藏。所以这里
 * 不用去停用那些入口——它们在本机模型下根本不出现。
 *
 * 剩下来的是几处**静态文案**仍然写着「your own Puter cloud」，不点登录也会
 * 看到（About 对话框、保存副本提示），把它们改成本机说法即可。
 */
export const edits = [
  {
    file: 'src/ui/appmenu.js',
    find: `      el('p.modal-text.about-tagline', {}, 'A fast, private spreadsheet. Your work is saved as standard .xlsx files in your own Puter cloud, ready to open anywhere.'),`,
    replace: `      el('p.modal-text.about-tagline', {}, 'A fast, private spreadsheet. Your work is saved as standard .xlsx files on this computer, ready to open anywhere.'),`,
    expect: 1,
    why: 'About 对话框的副标题：文件现在落在本机库目录，不再是 Puter 云盘。',
  },
  {
    file: 'src/views/editor.js',
    find: `      hint: \`Saved to \${P.FOLDER}/ in your Puter cloud. You will continue in the copy.\`,`,
    replace: `      hint: \`Saved to \${P.FOLDER}/ on this computer. You will continue in the copy.\`,`,
    expect: 1,
    why: '「保存副本」对话框的提示：保存目标是本机目录，不是 Puter 云。',
  },
];
