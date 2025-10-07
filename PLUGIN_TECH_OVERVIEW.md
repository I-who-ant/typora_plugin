# Typora Plugin Technical Overview

本文档总结 `typora_plugin` 仓库的主要技术实现与扩展要点，重点聚焦 `article_uploader` 插件的工作流程和配套基础设施。若需进一步了解基础插件系统，可配合 `plugin/global` 目录下的源码阅读。

## 1. 仓库结构综述

```
 typora_plugin/
 ├─ assets/                         # README 使用的截图与说明素材
 ├─ develop/                        # 脚本、示例与调试资源
 ├─ plugin/                         # 所有内置插件、全局组件与配置
 │   ├─ article_uploader/           # 文章上传插件（本文重点）
 │   ├─ ...                         # 其他内置插件：fence_enhance、ripgrep 等
 │   ├─ bin/                        # 安装脚本（install_linux.sh、install_windows.ps1 等）
 │   ├─ global/                     # 全局配置、国际化、UI 组件库
 │   ├─ preferences/                # Typora 插件设置面板逻辑
 │   └─ ...
 ├─ README.md / README-en.md        # 项目使用说明
 └─ LICENSE
```

Typora 通过 `plugin/index.js` 启动基础插件系统，将 `plugin` 目录打包并注入到 `window.html` 中（参见 `plugin/bin/install_linux.sh`），随后各插件基于统一的 `BasePlugin` 接口工作。

## 2. article_uploader 插件结构

```
plugin/article_uploader/
├─ README.md                     # 使用说明
├─ index.js                      # 插件入口，注册菜单与热键
├─ Plugin2UploadBridge.js        # 插件层与上传控制层之间的桥接
├─ controller/
│   └─ UploadController.js       # 管理具体上传器实例
├─ uploader/
│   ├─ BaseUploaderInterface.js
│   ├─ CnBlogUploader.js         # Selenium 自动化
│   ├─ CsdnUploader.js           # HTTP 逆向接口
│   ├─ WordpressUploader.js      # Selenium 自动化
│   └─ AstroUploader.js          # 本项目自定义上传器
└─ utils/
    ├─ uploadUtils.js            # 文件解析、签名计算、图片搬运等
    └─ customNotification.js     # 浏览器通知封装
```

### 2.1 插件入口 (`index.js`)
- 继承自 `BasePlugin`。
- 初始化时注册静态动作：`upload_to_csdn`、`upload_to_wordpress`、`upload_to_cn_blog`、`upload_to_astro`、`upload_to_all_site`。
- 按用户配置的热键触发 `call()`，进而调用 `upload()`。

### 2.2 Plugin2UploadBridge
- 负责懒加载依赖：`uploadUtils`、`UploadController`、自定义通知。
- 构造时维护 `sites` 数组（cnblog、csdn、wordpress、astro）。
- `uploadProxy()`：先弹出确认提示（依据配置 `upload.reconfirm`），然后调用 `UploadController` 完成上传，记录耗时并提示结果。

### 2.3 UploadController
- 保存插件配置、工具、已注册的 uploader 实例。
- `pathMap` 指向各具体 uploader 文件。
- `init()`：仅在启用 Selenium 平台（cnblog/csdn/wordpress）时引入 `selenium-webdriver/chrome` 并配置 headless 等参数。
- `register(site)`：若配置中 `upload.<site>.enabled` 为真则加载对应 uploader。
- `upload(platform, filePath)` / `uploadToAllPlatforms()`：读取文件、获取 title/content/frontmatter，依次调用具体 uploader 的 `upload()`。

### 2.4 UploadUtils
- 懒加载 `CryptoJS` 和 `js-yaml`；前者用于 CSDN 签名，后者用于解析 frontmatter。
- `readAndSplitFile(filePath)`：读取 Typora 当前文档，处理 frontmatter，并返回 `{ title, content, extraData }`。
  - `extractWithFrontmatter()` 识别带 `---` 的 YAML frontmatter；
  - `parseFrontmatter()` 支持全角引号、全角逗号的归一化；
  - `normalizeMeta()` 将 `tags` 统一转化为字符串数组，清理多余引号与空格；
  - 若前面失败退化为“首行作为标题，其余为内容”。
- `relocateImages(content, repoRoot)`：扫描 `![alt](abs-path)`，将图片复制到 `public/uploads/YYYY/MM/`，避免引用 `/home/...` 绝对路径。返回新的 Markdown 与资产列表。
- `getSign()`：为 CSDN 上传接口生成 HMAC-SHA256 签名。

### 2.5 AstroUploader
- 继承 `BaseUploaderInterface`，专为本地 Astro 项目生成 Markdown。
- 关键流程：
  1. 读取配置 `upload.astro.*`（仓库根、内容目录、文件命名模板、自动提交命令等）。
  2. 生成 slug/filename；组合 frontmatter（title、date、excerpt、tags、cover）。
  3. 调用 `relocateImages()` 复制资源，并写入最终 Markdown。
  4. 若配置了 auto git：执行命令模板，支持占位符 `{filename}`、`{filepath}`、`{tags}`、`{assets}`。
  5. Git 命令执行结果通过通知提示；若输出包含 “nothing to commit”，视为无改动直接跳过。

## 3. 全局配置与 UI

- `plugin/global/settings/settings.default.toml` 和 `settings.user.toml` 定义各插件参数。`article_uploader` 的关键项：
  - `UPLOAD_*_HOTKEY` 快捷键；
  - `upload.reconfirm`、`upload.selenium.headless`；
  - `upload.wordpress/cnblog/csdn/astro` 平台具体信息（账号、Cookie、仓库路径、命令模板等）。
- 设置面板 (`plugin/preferences/schemas.js`, `rules.js`) 中新增了 Astro 相关字段，使其在 GUI 中可视化配置。
- 通知组件 (`utils/customNotification.js`) 提供统一的成功/失败提示。

## 4. 自动化上传工作流

1. 用户在 Typora 中保存 Markdown。
2. 点击右键菜单或快捷键触发 `index.js` → `Plugin2UploadBridge.uploadProxy()`。
3. `UploadController.upload()` 读取文件并获取 frontmatter（YAML 容错）和正文。
4. `AstroUploader` 生成目标路径，复制图片，写入 Markdown。
5. 根据配置执行 Git 命令，反馈命令输出。
6. 命令成功后，例如 `git add '{filepath}' {assets} && git commit -m 'publish: {filename}' && git push`，文章和图片即被同步到仓库并推送远程。

## 5. 近期定制化改动

- **Frontmatter 容错**：补足 `parseFrontmatter()`，允许中文引号、逗号；无 `tags` 时保持数组为空。
- **图片搬运**：`relocateImages()` 自动复制 Markdown 引用的绝对路径图片，避免 Astro build 时找不到资源。
- **Git 命令增强**：支持 `{assets}` 占位符；对 “nothing to commit” 输出进行特殊处理，避免重复上传时失败。
- **Astro 目录结构约定**：文章写入 `src/content/posts`，图片写入 `public/uploads/YYYY/MM`。

## 6. 注意事项与最佳实践

- 上传前务必保存 Typora 文件（否则 `readFileSync` 抛出 ENOENT）。
- Frontmatter 使用合法 YAML；推荐字段：`title`、`date`、`description`、`tags`。
- 若手动删除文章或图片，需要手动 `git commit`，否则会影响自动命令。
- `install_linux.sh` 只负责在 Typora 资源目录注入插件，修改后需重新运行并重启 Typora。
- CSDN、WordPress、博客园 上传依赖不同：
  - CSDN 使用 HTTP 接口 + 自签名参数；
  - WordPress、CnBlog 通过 Selenium 控制 Chrome，需对应版本的 chromedriver。

## 7. 进一步扩展建议

- 若需要更多平台，可继承 `BaseUploaderInterface` 编写新的 uploader，`pathMap` 里注册即可。
- 可以在 `uploadUtils` 中增加更多 frontmatter 预处理，如自动生成 `excerpt`、`readingTime`。
- 对 AstroUploader 的 Git 命令模板，可结合自定义脚本执行构建或格式化任务。

---

