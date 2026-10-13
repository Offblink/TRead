# Design: 嵌套问答阅读器（暂名 nest-reader）

状态：待确认（brainstorm 阶段，未写一行代码）

## Problem

需要一个浏览器端阅读器：渲染 Markdown + LaTeX，读者可在任意疑问处划线提问，
AI 回答就地呈现；每个「提问」可展开为全屏子页面（标题=问题，正文=回答），
子页面内可继续划线提问 → 形成树。页面间需返回（父指针）与全局地图（右侧抽屉
树形导航）。UX 参考 Offblink/Gasp-Design。

## Context

- 参考项目 `Offblink/Gasp-Design`：GSAP 组件库，37 个自包含 HTML。视觉语言：
  - 底色 `#06060a`，卡片 `#0a0a14` + `1px #1a1a2e` 描边，hover 上浮 + 绿光晕
  - 点缀：`#4ade80`（主绿）/ `#60a5fa`（蓝）/ `#a78bfa`（紫）/ `#f472b6`（粉）
  - mono 字体标签、GSAP stagger / FLIP / clip-path 转场、磁吸光标
- 全新项目，无既有代码；本机 win11，用户偏好零构建/开箱即用风格。

## 核心概念（信息架构）

**拓扑 = 一棵（多导入时为多棵）树：**

- 根节点 = 导入的文档（md 原文）
- 子节点 = 一次提问（title = 提问原文，body = AI 回答的 md+latex）
- 子节点的 body 与根文档共用同一渲染+划线能力 → 递归天然成立
- 页面 = 当前所在节点；「< 返回」= 跳父节点；地图 = 全树导航

**数据模型：**

```js
Node {
  id, parentId,
  kind: 'doc' | 'qa',
  title,            // doc: 文件名 / qa: 提问原文
  content,          // md 正文（doc 原文 / qa 回答）
  anchor,           // qa: 源划线定位 {before, text, after}（text-quote 三元组）
  createdAt
}
Store: { roots: [NodeId], nodes: {id: Node} } → localStorage 自动存 + JSON 导出/导入
```

**上下文共享（核心机制，用户补充）：**

提问时送给 LLM 的 messages 不是孤立的当前页，而是**祖先链的完整对话继承**：

```
system: 你是精读助手（回答用 md+latex）
user:    <根文档全文>
—— 沿途每个祖先 QA（从根到父）——
user:    祖先问题（附其划线原文/位置）
assistant: 祖先回答全文
—— 当前页 ——
user:    当前页正文 + 本次划线选区（before/text/after）+ 新问题
```

- 链是纯函数：`buildContext(nodeId)` 沿 parentId 走到根，从 store 重建，无需额外存储；
- 同父的兄弟问题**共享同一段前缀**（祖先链只算一次，天然缓存 key = parentId）；
- 代价：深度×文档长度的 token 增长 → 截断策略见风险。

## 关键交互

1. **划线**：选中文本 → 浮动菜单（GSAP stagger 弹出）：`提问` / `再问一问`（+划线高亮 sweep-in）
2. **提问**：输入框（预填选中文本，可改）→ 流式生成 → 就地渲染速答卡片（md+latex）
3. **再问一问**：同一节点全屏展开——clip-path/FLIP 从选区放大成整页，
   顶栏显示「< 返回」+ 路径面包屑 + 地图按钮；正文 = 完整回答，可继续划线 → 嵌套
4. **地图抽屉**：顶栏地图按钮 → 右侧滑入；缩进树 + SVG 肘形连线；
   hover 节点 → tooltip 显示提问标题；click → 转场跳转；当前节点高亮描边
5. **划线持久化**：text-quote anchoring（before/text/after 三元组重新定位）；
   v1 限制：公式/代码块内部不支持划线（整块可提问）

## Options Considered

### Option A: 无构建 vanilla（ES modules + vendored 库）— 推荐

- 结构：`index.html` + `src/*.js` + `src/*.css`；库（markdown-it / katex /
  highlight.js / gsap）下载到 `vendor/` 本地，不依赖 CDN；`python -m http.server` 或
  双击+简易服务即可跑。
- Pros: 与 Gasp-Design 完全同构，风格延续；直接 DOM 控制，划线/选区不被框架
  reconciliation 冲掉；零工具链、零构建。
- Cons: 树状态 + 流式 + 转场全靠手写状态机，文件多了需纪律（约定 view render 函数）。
- Risk: 逻辑膨胀后可维护性下降 → 用「每视图一个 render 函数 + 单一 store」约束。

### Option B: Vite + React + TS 静态 SPA

- Pros: 树/流式/抽屉状态组件化，类型护住数据模型；生态库顺手。
- Cons: 引入构建链，与 Gasp 的「自包含 HTML」气质不符；React 重渲染与
  划线 DOM、GSAP 转场的共存要小心设计。
- Risk: 为中等规模项目付出工具链成本。

### Option C: B/A + 本地微服务（Node）

- Pros: AI 请求走服务端代理，无 CORS 顾虑；树可落盘成 JSON 文件，不怕清 localStorage。
- Cons: 多一个常驻进程，分发/启动复杂化。
- Risk: 单机自用场景收益有限。

## Recommended: Option A

理由：规模（预估 2–3k 行）vanilla 可控；划线与 GSAP 转场需要直接 DOM，
vanilla 反而更省心；与用户既有 Gasp 项目风格、零构建偏好一致。
CORS 是唯一潜在短板 → 计划里预留「可选微代理」开关（被墙/CORS 挡时再启用，属增量）。

## 计划（批准后执行）

1. 脚手架：目录 + vendored 依赖 + 暗色主题 tokens（取自 Gasp 色板）
2. 渲染内核：md + KaTeX + 代码高亮组件；内置示例文档（公式/表格/代码/列表）
3. 树与视图：数据模型 + localStorage store + 节点视图切换 + 「< 返回」+ 面包屑
4. 划线系统：选区 → 浮动菜单（GSAP）+ text-quote anchoring 持久化
5. 提问链路：输入 → buildContext 组装祖先链 messages → 流式回答 → 就地速答卡 → 「再问一问」全屏转场
6. 地图抽屉：右侧滑入 + SVG 连线树 + hover tooltip + click 跳转 + 当前高亮
7. 打磨：转场收放对称、空状态、API 失败态、刷新恢复
8. 验收：真机浏览器全流程冒烟（场景见下）

**验收场景**：打开文档 → 划线提问 → 流式回答就地渲染 → 再问一问全屏 →
在回答页再划线再问（深度 ≥2）→ **深链提问时抓包/日志确认 messages 含根文档+
沿途祖先问答（上下文继承）** → 地图跳转任意节点 → 返回逐级回根 →
刷新页面数据与划线仍在 → JSON 导出/导入可恢复。

## 风险

1. **划线锚定错位**（最大风险）：md 重渲染/字体变化后 range 失效 → text-quote
   anchoring + 只锚纯文本节点；错位时降级为「定位到最近命中」。
2. 公式内划线：KaTeX 内部 DOM 不可锚 → v1 禁止，整块可问。
3. CORS：浏览器直连 LLM 端点可能被拒 → 备可选微代理（C 的薄版）。
4. GSAP 全屏转场与浏览器前进/后退冲突 → 内部导航状态机，hash 变化映射到父/子。
5. 超大 md 性能：markdown-it + KaTeX 客户端渲染，十万字级无压力，更大再优化。
6. **上下文 token 增长**：链 = 根文档 + Σ祖先回答，深链×长文可能超窗 → v1 策略：
   根文档与祖先回答**全量携带**，超预算时从最远祖先开始截断（保新弃旧），
   组装后在请求前做字符预算裁剪并日志可见实际携带量；不做检索（避免引入新复杂度）。

## Open Questions（待用户拍板）

- [ ] 技术栈 A / B / C
- [ ] AI 接入方式（mock 先行 / 浏览器直连自配 OpenAI 兼容端点 / 微代理 / 指定某家）
- [ ] 文档来源（内置示例 / 本地 .md 导入 / 粘贴，可多选）
- [ ] 「提问 vs 再问一问」语义（统一模型 vs 分离模型）
- [ ] 项目落点目录
- [ ] 主题：v1 只做暗色（Gasp 风），是否需要亮色阅读主题
