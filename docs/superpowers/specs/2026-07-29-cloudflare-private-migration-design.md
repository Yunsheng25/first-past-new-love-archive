# Cloudflare 私有仓库迁移设计

## 目标

将《初恋 · 旧爱 · 新欢》项目网站从公开 GitHub Pages 迁移到独立的 Cloudflare Pages 项目，并使用：

- 正式网址：`film.yunsheng.ccwu.cc`
- 源码仓库：GitHub Private
- 部署方式：Cloudflare Pages 连接私有 GitHub 仓库，推送后自动更新

迁移后关闭原 GitHub Pages 站点，但保留 GitHub 仓库作为私有源码和版本备份。

## 已确认约束

- 不覆盖旧 Cloudflare Pages 项目 `blind-songs`。
- 使用新的独立 Cloudflare Pages 项目。
- 接受普通 Cloudflare 全球网络对中国大陆访问“多数情况下可用，但不保证所有网络始终稳定”。
- 不购买 Cloudflare Enterprise 中国网络，也不在本次范围内办理 ICP。
- 必须先验证 Cloudflare 新站，再关闭 GitHub Pages、再将仓库改为私有，避免断站。

## 部署结构

### Cloudflare Pages 项目

创建新的 Pages 项目，建议项目名：

`first-past-new-love-archive`

项目通过 Cloudflare GitHub App 获得该单一仓库的读取权限。GitHub 仓库改为私有后，授权继续有效，Cloudflare 可在 `main` 分支更新时自动部署。

### 发布产物

新增明确的 Cloudflare 发布目录 `dist/`。构建过程只复制浏览器运行所需内容，包括：

- `index.html`
- 主样式、主脚本和预加载清单
- `src/` 中浏览器运行模块
- 网站使用的 `assets/`、`vendor/` 和数据文件
- 站点运行必须的其他静态资源

以下内容不得进入发布目录：

- `.git/`
- `tests/`
- `docs/`
- 本地认证文件和缓存
- 构建脚本、临时文件和未跟踪工作目录

Cloudflare Pages 的构建命令生成 `dist/`，发布目录设置为 `dist`。

## 域名与 DNS

正式域名为 `film.yunsheng.ccwu.cc`。

部署成功后，通过 Cloudflare Pages 的 Custom domains 流程绑定该子域名。不能只手工创建 CNAME 而跳过 Pages 的域名关联步骤。由 Cloudflare 自动建立或校验 DNS 记录并签发 HTTPS 证书。

根域名 `yunsheng.ccwu.cc` 的现有内容和 DNS 不做改动。

## 迁移顺序

1. 为当前网站建立最小发布产物构建。
2. 在本地验证发布产物与当前网站内容一致。
3. 创建新的 Cloudflare Pages 项目并连接 GitHub。
4. 使用 Cloudflare 提供的临时 `pages.dev` 地址验证部署。
5. 绑定 `film.yunsheng.ccwu.cc` 并等待 HTTPS 生效。
6. 验证正式域名。
7. 关闭 GitHub Pages。
8. 将 GitHub 仓库从 Public 改为 Private。
9. 再次验证 Cloudflare 能从私有仓库部署。

只有前一步验证成功后，才能执行下一步。

## 验收标准

Cloudflare 临时地址和正式域名都必须通过以下检查：

- 首页背景影片、标题、圆环鼠标和粒子效果正常。
- 完整影片可播放、拖动进度、退出。
- “影片已结束”页面和两个入口正常。
- 提示词隧道、思维导图、图片弹层和提示词内容正常。
- 复盘目录、翻页、批注图片和案例视频正常。
- BGM 可由用户主动开启和关闭。
- 手机与电脑布局可用。
- 图片、视频和音频请求不出现 404。
- 视频支持字节范围请求，拖动进度不会失效。
- HTTPS 证书有效。

## 隐私边界

仓库改为私有后，GitHub 上的源码、测试、文档和提交历史不再向公众开放。

网页运行所必须的 HTML、CSS、JavaScript、图片、音频和视频仍会由 Cloudflare 公开提供，访问者可在浏览器中查看或下载这些公开资源。这是公开网站无法避免的边界。

## 失败与回退

- Cloudflare 构建失败：不关闭 GitHub Pages，不改变仓库可见性。
- 自定义域名或 HTTPS 未生效：继续使用 Cloudflare 临时地址验证，GitHub 旧站保持在线。
- 仓库改为私有后 Cloudflare 失去权限：重新授权 Cloudflare GitHub App；在重新部署成功前不删除任何源码或历史。
- 不删除旧 `blind-songs` 项目，不修改它的域名和部署。
