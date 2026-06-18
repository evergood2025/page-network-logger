# Page Network Logger

English | [中文](#中文)

Page Network Logger is a Tampermonkey / Userscript utility that records the current page's `Fetch/XHR` requests and exports them as a structured JSON network log.

It is designed for quick, page-level network inspection when you want to understand what happened during a specific user action without exporting a full browser HAR file.

It is useful for checking:

- Which API requests a page actually sends
- Whether requests are duplicated
- Which requests failed, became slow, or returned large responses
- Whether request parameters and response structures are expected
- Whether a page returns unnecessary large arrays or fields
- Whether a filter, search, pagination, submit, or navigation action triggered the expected backend calls
- Whether a page is slow because of repeated frontend requests or because a specific backend API is slow
- What response shape an API returned without manually copying data from DevTools

It is especially useful when sharing a compact network evidence file with teammates, issue trackers, or AI assistants. The exported JSON focuses on request summaries and response shape, so it is usually easier to review than a raw HAR export.

It is not intended to replace the browser DevTools Network panel, full HAR export, performance profiling, or security auditing tools.

## Features

- Capture `fetch` and `XMLHttpRequest`
- Export a structured JSON network log
- Generate a request summary automatically
- Mark failed, duplicated, slow, and large requests
- Summarize JSON response keys, array fields, and large fields
- Do not capture `console` by default
- Optionally capture `console/error`
- Redact common sensitive request headers
- Switch between English and Chinese based on browser language

## Installation

1. Install Tampermonkey, Violentmonkey, or another userscript manager.
2. Open `page-network-logger.user.js`.
3. Copy the script, create a new userscript, paste it, and save.

If published on Greasy Fork / OpenUserJS, install it directly from the release page.

## Usage

1. Open the page you want to inspect.
2. Click the small handle on the right edge to expand the panel.
3. Click `Start`.
4. Reproduce the issue or perform the target action.
5. Click `Stop & Export`.
6. The tool copies JSON to the clipboard and downloads a `network-log_*.json` file.

## Limit Matched Sites

By default, the script runs on all HTTP/HTTPS pages:

```js
// @match        http://*/*
// @match        https://*/*
```

To limit it to specific sites, replace those lines with:

```js
// @match        https://example.com/*
// @match        https://*.example.com/*
```

It is recommended to record only on websites you trust.

## Privacy & Security

The tool redacts common sensitive request headers by default, including:

- `authorization`
- `cookie`
- `set-cookie`
- `token`
- `access-token`
- `refresh-token`

Request and response bodies may still contain business data such as names, phone numbers, accounts, addresses, orders, or user records. Review exported JSON before sharing it.

## Export Format

The exported JSON has this general structure:

```json
{
  "meta": {},
  "summary": {},
  "ignoredRequests": [],
  "requests": [],
  "console": []
}
```

Fields:

- `meta`: page URL, browser info, time window, action note, etc.
- `summary`: request count, failed requests, duplicated requests, slow requests, large responses
- `ignoredRequests`: filtered development helper requests
- `requests`: Fetch/XHR request details and response shape summaries
- `console`: optional console/error appendix

## Notes

- This is not a full HAR exporter.
- It focuses on `Fetch/XHR` by default, not images, CSS, fonts, or JS files.
- It does not capture WebSocket traffic.
- To capture initial page-load requests, click Start and then refresh the page.
- Large responses are truncated to keep exported files manageable.

## License

MIT

---

## 中文

页面网络日志导出器是一个 Tampermonkey / Userscript 小工具，用来记录当前页面的 `Fetch/XHR` 请求，并导出结构化 JSON 网络日志。

它适合做轻量级的页面网络取证：当你想知道某次点击、筛选、搜索、翻页或提交到底触发了哪些接口时，不需要导出完整 HAR，也不用手动从 DevTools 里复制请求和响应。

它适合用来排查：

- 页面实际请求了哪些接口
- 是否有重复请求
- 哪些接口失败、变慢或响应过大
- 请求参数和响应结构是否符合预期
- 当前页面是否返回了不必要的大数组或大字段
- 筛选、搜索、分页、提交、跳转等操作是否触发了预期接口
- 页面变慢是因为前端重复请求，还是某个后端接口本身慢
- 不手动复制 DevTools 内容，也能拿到接口返回结构和关键预览

它适合把一次页面操作的网络证据整理成一个较小的 JSON 文件，方便发给同事、贴到 issue，或交给 AI 助手 / 排查工具继续分析。

它不是浏览器 DevTools Network 面板、完整 HAR 导出、性能分析工具或安全审计工具的替代品。

## 功能

- 抓取当前页面的 `fetch` 和 `XMLHttpRequest`
- 导出 JSON 网络日志
- 自动生成请求摘要
- 标记失败请求、重复请求、慢请求和大响应
- 展示 JSON 响应的顶层字段、数组字段和大字段
- 默认不抓 `console`
- 可选抓取 `console/error`
- 默认脱敏常见敏感请求头
- 支持中英文界面，按浏览器语言自动切换

## 安装

1. 安装 Tampermonkey、Violentmonkey 或其他 userscript 管理器。
2. 打开 `page-network-logger.user.js`。
3. 复制脚本内容，新建 userscript 并粘贴保存。

如果发布到了 Greasy Fork / OpenUserJS，可以直接从发布页面安装。

## 使用

1. 打开需要排查的页面。
2. 点击页面右侧的小把手，展开面板。
3. 点击 `开始录制`。
4. 在页面上复现问题或执行目标操作。
5. 点击 `停止并导出`。
6. 工具会复制 JSON 到剪贴板，并下载一份 `network-log_*.json` 文件。

## 限制运行网站

默认脚本会在所有 HTTP/HTTPS 页面运行：

```js
// @match        http://*/*
// @match        https://*/*
```

如果只想在指定网站使用，可以把上面两行替换成：

```js
// @match        https://example.com/*
// @match        https://*.example.com/*
```

建议只在自己信任的网站上启用录制。

## 隐私与安全

工具默认会脱敏常见敏感请求头，例如：

- `authorization`
- `cookie`
- `set-cookie`
- `token`
- `access-token`
- `refresh-token`

但请求体和响应体可能仍包含业务数据，例如姓名、手机号、账号、地址、订单、学生信息等。分享导出的 JSON 前，请先确认内容是否适合外发。

## 导出格式

导出的 JSON 大致结构如下：

```json
{
  "meta": {},
  "summary": {},
  "ignoredRequests": [],
  "requests": [],
  "console": []
}
```

字段说明：

- `meta`：页面 URL、浏览器信息、时间窗、动作备注等
- `summary`：请求总数、失败请求、重复请求、慢请求、大响应等摘要
- `ignoredRequests`：被过滤的开发辅助请求
- `requests`：每个 Fetch/XHR 请求的详情和响应结构摘要
- `console`：可选的 console/error 附录

## 注意

- 这个工具不是完整 HAR 导出器。
- 它默认只关注 `Fetch/XHR`，不记录图片、CSS、字体、JS 文件等静态资源。
- 它不覆盖 WebSocket。
- 如果需要抓页面首次加载请求，可以先点击开始录制，再刷新页面。
- 大响应会被截断，避免导出文件过大。

## 许可证

MIT
