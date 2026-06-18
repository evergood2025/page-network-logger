// ==UserScript==
// @name         Page Network Logger
// @name:zh-CN   页面网络日志导出器
// @namespace    page-network-logger
// @version      1.8.0
// @description  Export current page Fetch/XHR requests and responses as a structured JSON network log.
// @description:zh-CN 导出当前页面 Fetch/XHR 请求和响应内容，生成结构化 JSON 网络日志。
// @author       https://github.com/evergood2025
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        none
//
// Default: runs on all HTTP/HTTPS pages.
// To limit it to specific sites, replace the two @match lines above, for example:
// @match        https://example.com/*
// @match        https://*.example.com/*
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const TEXTS = {
    en: {
      appName: 'Page Network Logger',
      injectFailed: 'Failed to inject page agent:',
      start: 'Start',
      stop: 'Stop & Export',
      window: 'Window(s)',
      captureConsole: 'Capture console/error',
      notePlaceholder: 'Action note, e.g. open user detail page',
      tip: 'Flow: Start → reproduce → Stop & Export',
      recording: 'Recording...',
      recordingStarted: 'Recording started',
      copied: 'Copied to clipboard',
      copyFailed: 'Failed to copy:',
      downloadFailed: 'Failed to download:',
    },
    zh: {
      appName: '页面网络日志导出器',
      injectFailed: '页面代理注入失败：',
      start: '开始录制',
      stop: '停止并导出',
      window: '时间窗(s)',
      captureConsole: '抓 console/error',
      notePlaceholder: '动作备注：例如进入用户详情页',
      tip: '流程：开始 → 复现问题 → 停止并导出',
      recording: '录制中...',
      recordingStarted: '开始录制',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败：',
      downloadFailed: '下载失败：',
    },
  };

  const getLanguage = () => {
    const languages = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    return languages.some(lang => String(lang).toLowerCase().startsWith('zh')) ? 'zh' : 'en';
  };

  const TEXT = TEXTS[getLanguage()];

  const APP = {
    name: TEXT.appName,
    bus: '__PAGE_NETWORK_LOGGER__',
    controlBus: '__PAGE_NETWORK_LOGGER_CONTROL__',
    format: 'page-network-log-v1',
  };

  const CONFIG = {
    defaultWindowSec: 15,
    agentBodyPreviewLimit: 128 * 1024,
    exportBodyPreviewLimit: 12 * 1024,
    requestBodyPreviewLimit: 2048,
    consoleTextPreviewLimit: 1500,
    slowRequestMs: 1000,
    largeResponseBytes: 50 * 1024,
    panelWidth: 280,
    collapsedWidth: 28,
    edgeVisible: 16,
  };

  const SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-token',
    'x-auth-token',
    'token',
    'access-token',
    'refresh-token',
    'x-umami-cache',
  ];

  const DEV_REQUEST_PATTERNS = [
    '__open-in-editor',
    '/@vite/',
    '/__vite_ping',
    '/sockjs-node',
    '/webpack-hmr',
    '/favicon.ico',
    '.map',
    'hot-update',
  ];

  const state = {
    recording: false,
    captureConsole: false,
    timeWindowSec: CONFIG.defaultWindowSec,
    actionNote: '',
    startTS: 0,
    endTS: 0,
    net: [],
    logs: [],
    collapsed: true,
    lastExpanded: null,
  };

  function injectPageAgent() {
    try {
      if (window.__PAGE_NETWORK_LOGGER_AGENT_INSTALLED__) return;
      window.__PAGE_NETWORK_LOGGER_AGENT_INSTALLED__ = true;
    } catch {
      return;
    }

    const source = `(${pageAgent})(${JSON.stringify({
      bus: APP.bus,
      controlBus: APP.controlBus,
      bodyPreviewLimit: CONFIG.agentBodyPreviewLimit,
      sensitiveHeaders: SENSITIVE_HEADERS,
    })});`;

    try {
      const script = document.createElement('script');
      script.textContent = source;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn(`[${APP.name}] ${TEXT.injectFailed}`, e);
    }
  }

  function pageAgent(options) {
    const BUS = options.bus;
    const CONTROL_BUS = options.controlBus;
    const BODY_PREVIEW_LIMIT = options.bodyPreviewLimit;
    const SENSITIVE = new Set(options.sensitiveHeaders || []);

    const runtime = {
      captureConsole: false,
      consoleInstalled: false,
      errorsInstalled: false,
    };

    const post = (type, payload) => {
      try {
        window.postMessage({ [BUS]: true, type, payload, ts: Date.now() }, '*');
      } catch {}
    };

    const safeStringify = (value) => {
      try {
        const seen = new WeakSet();
        return JSON.stringify(value, function (_key, item) {
          if (item && typeof item === 'object') {
            if (seen.has(item)) return '[Circular]';
            seen.add(item);
          }
          return item;
        }, 2);
      } catch {
        return '';
      }
    };

    const truncate = (text, limit) => {
      const raw = String(text || '');
      if (raw.length <= limit) return raw;
      return `${raw.slice(0, limit)}\n/* [TRUNCATED ${raw.length - limit} chars] */`;
    };

    const bodyToText = async (body) => {
      try {
        if (body == null) return '';
        if (typeof body === 'string') return truncate(body, BODY_PREVIEW_LIMIT);
        if (body instanceof ArrayBuffer) {
          return truncate(new TextDecoder().decode(new Uint8Array(body)), BODY_PREVIEW_LIMIT);
        }
        if (body instanceof Blob) {
          return truncate(await body.slice(0, BODY_PREVIEW_LIMIT).text(), BODY_PREVIEW_LIMIT);
        }
        if (body instanceof FormData) {
          const data = {};
          for (const [key, value] of body.entries()) {
            data[key] = value && value.name ? `[File:${value.name}]` : String(value);
          }
          return truncate(safeStringify(data), BODY_PREVIEW_LIMIT);
        }
        if (body instanceof URLSearchParams) return truncate(body.toString(), BODY_PREVIEW_LIMIT);
        if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[ReadableStream]';
        return truncate(safeStringify(body), BODY_PREVIEW_LIMIT);
      } catch (e) {
        return `/* [Preview Error] ${e && e.message} */`;
      }
    };

    const redactHeaders = (headers) => {
      const result = {};
      try {
        if (!headers) return result;
        if (typeof headers.forEach === 'function') {
          headers.forEach((value, key) => {
            result[key] = SENSITIVE.has(String(key).toLowerCase()) ? '[REDACTED]' : value;
          });
          return result;
        }
        Object.entries(headers).forEach(([key, value]) => {
          result[key] = SENSITIVE.has(String(key).toLowerCase()) ? '[REDACTED]' : value;
        });
      } catch {}
      return result;
    };

    const parseRawHeaders = (raw) => {
      const result = {};
      if (!raw) return result;
      String(raw).trim().split(/\r?\n/).forEach(line => {
        const index = line.indexOf(':');
        if (index < 0) return;
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        result[key] = SENSITIVE.has(key.toLowerCase()) ? '[REDACTED]' : value;
      });
      return result;
    };

    const installConsoleCapture = () => {
      if (runtime.consoleInstalled) return;
      runtime.consoleInstalled = true;

      ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach(type => {
        try {
          const original = console[type];
          console[type] = function (...args) {
            try {
              if (runtime.captureConsole) {
                post('console', {
                  subType: type,
                  args: args.map(arg => {
                    try {
                      return typeof arg === 'string' ? arg : JSON.parse(safeStringify(arg));
                    } catch {
                      return String(arg);
                    }
                  }),
                  stack: type === 'trace' ? (new Error()).stack?.split('\n').slice(1, 12).join('\n') : '',
                });
              }
            } catch {}
            return original && original.apply(console, args);
          };
        } catch {}
      });
    };

    const installErrorCapture = () => {
      if (runtime.errorsInstalled) return;
      runtime.errorsInstalled = true;

      window.addEventListener('error', (event) => {
        if (!runtime.captureConsole) return;
        const target = event.target;
        const isResource = target && target !== window && (target.src || target.href);
        if (isResource) {
          post('exception', {
            kind: 'resource-error',
            tag: target.tagName,
            src: target.src || target.href || '',
          });
          return;
        }
        post('exception', {
          kind: 'uncaught-error',
          message: event.message || '',
          filename: event.filename || '',
          lineno: event.lineno || 0,
          colno: event.colno || 0,
          stack: event.error && event.error.stack ? String(event.error.stack) : '',
        });
      }, true);

      window.addEventListener('unhandledrejection', (event) => {
        if (!runtime.captureConsole) return;
        const reason = event && event.reason;
        post('exception', {
          kind: 'unhandled-rejection',
          reason: typeof reason === 'string' ? reason : safeStringify(reason),
          stack: reason && reason.stack ? String(reason.stack) : '',
        });
      });
    };

    const installFetchCapture = () => {
      try {
        if (window.__PAGE_NETWORK_LOGGER_FETCH_INSTALLED__) return;
        window.__PAGE_NETWORK_LOGGER_FETCH_INSTALLED__ = true;

        const originalFetch = window.fetch;
        if (!originalFetch) return;

        window.fetch = async function (input, init) {
          const startedAt = Date.now();
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = (init && init.method) || (input && input.method) || 'GET';
          const reqHeaders = (init && init.headers) || (input && input.headers) || {};
          const reqBody = init && init.body;
          const reqBodyPreview = await bodyToText(reqBody);

          try {
            const response = await originalFetch.apply(this, arguments);
            const clone = response.clone();
            let responseText = '';
            try {
              responseText = await clone.text();
            } catch (e) {
              responseText = `/* [Response Preview Error] ${e && e.message} */`;
            }

            post('net', {
              kind: 'fetch',
              url,
              method,
              status: response.status,
              ok: response.ok,
              durationMs: Date.now() - startedAt,
              request: {
                headers: redactHeaders(reqHeaders),
                bodyPreview: reqBodyPreview,
              },
              response: {
                headers: redactHeaders(response.headers),
                bodyPreview: truncate(responseText, BODY_PREVIEW_LIMIT),
              },
            });
            return response;
          } catch (error) {
            post('net', {
              kind: 'fetch',
              url,
              method,
              status: -1,
              ok: false,
              durationMs: Date.now() - startedAt,
              request: {
                headers: redactHeaders(reqHeaders),
                bodyPreview: reqBodyPreview,
              },
              response: {
                headers: {},
                bodyPreview: `[Fetch Error] ${error && error.message}`,
              },
            });
            throw error;
          }
        };
      } catch {}
    };

    const installXhrCapture = () => {
      try {
        if (window.__PAGE_NETWORK_LOGGER_XHR_INSTALLED__) return;
        window.__PAGE_NETWORK_LOGGER_XHR_INSTALLED__ = true;

        const proto = XMLHttpRequest && XMLHttpRequest.prototype;
        if (!proto) return;

        const originalOpen = proto.open;
        const originalSend = proto.send;
        const originalSetRequestHeader = proto.setRequestHeader;

        proto.open = function (method, url) {
          try {
            this.__tjApiCapture = { method, url, headers: {}, body: null, startedAt: 0 };
          } catch {}
          return originalOpen.apply(this, arguments);
        };

        proto.setRequestHeader = function (key, value) {
          try {
            this.__tjApiCapture = this.__tjApiCapture || { headers: {} };
            this.__tjApiCapture.headers[key] = value;
          } catch {}
          return originalSetRequestHeader.apply(this, arguments);
        };

        proto.send = function (body) {
          try {
            const meta = this.__tjApiCapture || (this.__tjApiCapture = { headers: {} });
            meta.startedAt = Date.now();
            meta.body = body;

            const xhr = this;
            const done = async () => {
              try {
                post('net', {
                  kind: 'xhr',
                  url: meta.url,
                  method: meta.method || 'GET',
                  status: typeof xhr.status === 'number' ? xhr.status : -1,
                  ok: typeof xhr.status === 'number' && xhr.status >= 200 && xhr.status < 300,
                  durationMs: Date.now() - meta.startedAt,
                  request: {
                    headers: redactHeaders(meta.headers || {}),
                    bodyPreview: await bodyToText(meta.body),
                  },
                  response: {
                    headers: parseRawHeaders(xhr.getAllResponseHeaders && xhr.getAllResponseHeaders()),
                    bodyPreview: await bodyToText(xhr.response),
                  },
                });
              } catch {}
            };

            xhr.addEventListener('load', done);
            xhr.addEventListener('error', done);
            xhr.addEventListener('abort', done);
          } catch {}
          return originalSend.apply(this, arguments);
        };
      } catch {}
    };

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || !data[CONTROL_BUS]) return;
      if (data.type === 'setOptions') {
        runtime.captureConsole = !!(data.payload && data.payload.captureConsole);
        if (runtime.captureConsole) {
          installConsoleCapture();
          installErrorCapture();
        }
      }
    });

    installFetchCapture();
    installXhrCapture();
  }

  function postAgentOptions() {
    try {
      window.postMessage({
        [APP.controlBus]: true,
        type: 'setOptions',
        payload: { captureConsole: state.captureConsole },
      }, '*');
    } catch {}
  }

  function normalizeUrlInfo(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return {
        fullUrl: url.href,
        origin: url.origin,
        path: url.pathname,
        query: url.search ? url.search.slice(1) : '',
        pathWithQuery: `${url.pathname}${url.search}`,
      };
    } catch {
      const text = String(rawUrl || '').split('#')[0];
      return {
        fullUrl: text,
        origin: '',
        path: text.split('?')[0],
        query: text.split('?')[1] || '',
        pathWithQuery: text,
      };
    }
  }

  function safeStringify(value) {
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, function (_key, item) {
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      });
    } catch {
      return '';
    }
  }

  function byteSize(value) {
    try {
      return new Blob([String(value || '')]).size;
    } catch {
      return String(value || '').length;
    }
  }

  function truncateText(value, limit) {
    const raw = String(value || '');
    if (raw.length <= limit) return raw;
    return `${raw.slice(0, limit)}\n/* [NETWORK_LOG_TRUNCATED ${raw.length - limit} chars] */`;
  }

  function tryJson(text) {
    if (typeof text !== 'string') return null;
    const raw = text.trim();
    if (!raw || !/^[\[{]/.test(raw)) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function isDevHelperRequest(request) {
    const info = normalizeUrlInfo(request.url || '');
    const target = `${info.fullUrl} ${info.pathWithQuery}`;
    return DEV_REQUEST_PATTERNS.some(pattern => target.includes(pattern));
  }

  function summarizeJson(value) {
    const fields = [];
    const arrays = [];

    const typeOf = (item) => {
      if (Array.isArray(item)) return `array[${item.length}]`;
      if (item === null) return 'null';
      return typeof item;
    };

    const pickShape = (object) => {
      if (!object || typeof object !== 'object' || Array.isArray(object)) return {};
      return Object.fromEntries(Object.keys(object).slice(0, 40).map(key => [key, typeOf(object[key])]));
    };

    const visit = (item, path, depth) => {
      if (depth > 4 || !item || typeof item !== 'object') return;

      if (Array.isArray(item)) {
        const size = byteSize(safeStringify(item));
        arrays.push({ path, length: item.length, approxBytes: size });
        if (size >= 1024) fields.push({ path, type: `array[${item.length}]`, approxBytes: size });
        if (item.length && typeof item[0] === 'object') visit(item[0], `${path}[0]`, depth + 1);
        return;
      }

      Object.keys(item).slice(0, 80).forEach(key => {
        const next = item[key];
        const nextPath = path ? `${path}.${key}` : key;
        if (next && typeof next === 'object') {
          const size = byteSize(safeStringify(next));
          if (size >= 1024) fields.push({ path: nextPath, type: typeOf(next), approxBytes: size });
          visit(next, nextPath, depth + 1);
        } else if (typeof next === 'string' && byteSize(next) >= 1024) {
          fields.push({ path: nextPath, type: 'string', approxBytes: byteSize(next) });
        }
      });
    };

    visit(value, '', 0);

    const data = value && typeof value === 'object' && !Array.isArray(value) ? value.data : undefined;
    const largeFields = Array.from(new Map(fields.map(item => [`${item.path}:${item.type}`, item])).values());

    return {
      rootType: typeOf(value),
      topLevelKeys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 60) : [],
      dataType: typeOf(data),
      dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 80) : [],
      dataShape: pickShape(data),
      arrayFields: arrays.sort((a, b) => b.approxBytes - a.approxBytes).slice(0, 8),
      largeFields: largeFields.sort((a, b) => b.approxBytes - a.approxBytes).slice(0, 8),
    };
  }

  function summarizeRequest(rawRequest) {
    const info = normalizeUrlInfo(rawRequest.url || '');
    const requestText = rawRequest.request && rawRequest.request.bodyPreview ? String(rawRequest.request.bodyPreview) : '';
    const responseText = rawRequest.response && rawRequest.response.bodyPreview ? String(rawRequest.response.bodyPreview) : '';
    const responseJson = tryJson(responseText);

    return {
      ts: rawRequest.ts,
      kind: rawRequest.kind,
      method: String(rawRequest.method || 'GET').toUpperCase(),
      url: info.fullUrl,
      path: info.path,
      query: info.query,
      pathWithQuery: info.pathWithQuery,
      status: rawRequest.status,
      ok: rawRequest.ok,
      durationMs: rawRequest.durationMs,
      requestBodyBytes: byteSize(requestText),
      responseBodyBytes: byteSize(responseText),
      responseTruncatedByAgent: responseText.includes('[TRUNCATED') || responseText.includes('[NETWORK_LOG_TRUNCATED'),
      requestHeaders: rawRequest.request ? rawRequest.request.headers || {} : {},
      responseHeaders: rawRequest.response ? rawRequest.response.headers || {} : {},
      responseJson: responseJson ? summarizeJson(responseJson) : null,
      requestBodyPreview: truncateText(requestText, CONFIG.requestBodyPreviewLimit),
      responseBodyPreview: truncateText(responseText, CONFIG.exportBodyPreviewLimit),
    };
  }

  function compactValue(value, depth = 0) {
    if (value == null) return value;
    if (typeof value === 'string') return truncateText(value, CONFIG.consoleTextPreviewLimit);
    if (typeof value === 'number' || typeof value === 'boolean') return value;

    const approxBytes = byteSize(safeStringify(value));
    if (depth >= 2 || approxBytes > 4096) {
      if (Array.isArray(value)) {
        return {
          __type: 'array',
          length: value.length,
          approxBytes,
          sample: value.slice(0, 3).map(item => compactValue(item, depth + 1)),
        };
      }
      return {
        __type: 'object',
        keys: Object.keys(value).slice(0, 30),
        approxBytes,
      };
    }

    if (Array.isArray(value)) return value.slice(0, 10).map(item => compactValue(item, depth + 1));
    if (typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).slice(0, 30).map(key => [key, compactValue(value[key], depth + 1)]));
    }
    return truncateText(String(value), CONFIG.consoleTextPreviewLimit);
  }

  function compactLog(rawLog) {
    let item = rawLog;
    if (rawLog.type === 'console') item = { ts: rawLog.ts, cat: 'console', ...rawLog.payload };
    if (rawLog.type === 'exception') item = { ts: rawLog.ts, cat: 'exception', ...rawLog.payload };

    const compacted = { ...item, approxBytesBeforeCompact: byteSize(safeStringify(item)) };
    if (Array.isArray(compacted.args)) {
      compacted.args = compacted.args.slice(0, 8).map(arg => compactValue(arg));
    }
    if (compacted.reason) compacted.reason = compactValue(compacted.reason);
    if (compacted.stack) compacted.stack = truncateText(compacted.stack, 3000);
    return compacted;
  }

  function buildSummary(requests, ignoredRequests, logs) {
    const groups = new Map();

    requests.forEach(request => {
      const key = `${request.method} ${request.pathWithQuery}`;
      const group = groups.get(key) || {
        key,
        method: request.method,
        pathWithQuery: request.pathWithQuery,
        count: 0,
        statuses: new Set(),
        totalMs: 0,
        totalBytes: 0,
        samples: [],
      };

      group.count += 1;
      group.statuses.add(request.status);
      group.totalMs += Number(request.durationMs || 0);
      group.totalBytes += Number(request.responseBodyBytes || 0);
      if (group.samples.length < 3) {
        group.samples.push({
          status: request.status,
          durationMs: request.durationMs,
          responseBodyBytes: request.responseBodyBytes,
        });
      }
      groups.set(key, group);
    });

    const apiGroups = Array.from(groups.values()).map(group => ({
      key: group.key,
      method: group.method,
      pathWithQuery: group.pathWithQuery,
      count: group.count,
      statuses: Array.from(group.statuses),
      avgDurationMs: Math.round(group.totalMs / group.count),
      totalResponseBytes: group.totalBytes,
      samples: group.samples,
    })).sort((a, b) => b.count - a.count || b.totalResponseBytes - a.totalResponseBytes);

    const consoleCounts = logs.reduce((acc, item) => {
      const key = item.cat === 'console' ? `console.${item.subType || 'log'}` : item.cat || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      requestTotal: requests.length,
      ignoredDevRequestTotal: ignoredRequests.length,
      failedRequests: requests.filter(request => !request.ok || Number(request.status) >= 400).map(request => ({
        method: request.method,
        pathWithQuery: request.pathWithQuery,
        status: request.status,
        durationMs: request.durationMs,
      })),
      duplicatedRequests: apiGroups.filter(group => group.count > 1),
      slowRequests: requests.filter(request => Number(request.durationMs || 0) >= CONFIG.slowRequestMs)
        .sort((a, b) => b.durationMs - a.durationMs)
        .map(request => ({
          method: request.method,
          pathWithQuery: request.pathWithQuery,
          status: request.status,
          durationMs: request.durationMs,
        })),
      largeResponses: requests.filter(request => Number(request.responseBodyBytes || 0) >= CONFIG.largeResponseBytes)
        .sort((a, b) => b.responseBodyBytes - a.responseBodyBytes)
        .map(request => ({
          method: request.method,
          pathWithQuery: request.pathWithQuery,
          responseBodyBytes: request.responseBodyBytes,
        })),
      apiGroups,
      consoleCounts,
    };
  }

  function buildCapturePayload() {
    const cutoff = state.endTS - state.timeWindowSec * 1000;
    const rawRequests = state.net
      .filter(item => item.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts)
      .map(item => ({ ts: item.ts, ...item.payload }));

    const ignoredRequests = rawRequests
      .filter(isDevHelperRequest)
      .map(request => {
        const info = normalizeUrlInfo(request.url || '');
        return {
          ts: request.ts,
          kind: request.kind,
          method: String(request.method || 'GET').toUpperCase(),
          pathWithQuery: info.pathWithQuery,
          status: request.status,
          durationMs: request.durationMs,
        };
      });

    const requests = rawRequests
      .filter(request => !isDevHelperRequest(request))
      .map(summarizeRequest);

    const logs = state.logs
      .filter(item => item.ts >= cutoff)
      .map(compactLog);

    return {
      meta: {
        capturedAt: new Date().toISOString(),
        windowSec: state.timeWindowSec,
        actionNote: state.actionNote,
        pageURL: location.href,
        userAgent: navigator.userAgent,
        format: APP.format,
        captureConsole: state.captureConsole,
      },
      summary: buildSummary(requests, ignoredRequests, logs),
      ignoredRequests,
      requests,
      console: logs,
    };
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function downloadJson(text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildDownloadFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function buildDownloadFilename() {
    const route = getCurrentRouteInfo();
    return `network-log_${route.slug}${route.filtered ? '_filtered' : ''}.json`;
  }

  function getCurrentRouteInfo() {
    const raw = location.hash && location.hash.startsWith('#')
      ? location.hash.slice(1)
      : `${location.pathname}${location.search}`;
    const [pathPart, queryPart = ''] = raw.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const meaningfulSegments = segments.filter(item => !['teacher', 'student', 'admin'].includes(item));
    const tail = meaningfulSegments.slice(-2);
    const slugSource = tail.length ? tail.join('-') : 'page';
    const slug = slugSource
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'page';

    return {
      slug,
      filtered: Boolean(queryPart),
    };
  }

  function installMessageReceiver() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || !data[APP.bus]) return;
      if (!state.recording) return;
      if (data.type !== 'net' && !state.captureConsole) return;

      const item = { ts: data.ts || Date.now(), type: data.type, payload: data.payload };
      if (data.type === 'net') state.net.push(item);
      else state.logs.push(item);
    });
  }

  function renderPanel() {
    if (document.querySelector('.pnl-panel')) return;

    const style = document.createElement('style');
    style.textContent = `
      .pnl-panel{
        position:fixed; right:24px; bottom:24px; z-index:999999;
        width:${CONFIG.panelWidth}px; box-sizing:border-box; padding:12px 14px;
        background:rgba(0,0,0,.80); color:#fff;
        font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,.20);
        transition:padding .25s ease,width .25s ease;
      }
      .pnl-panel.is-collapsed{
        width:${CONFIG.collapsedWidth}px; padding:18px 6px; cursor:pointer;
      }
      .pnl-panel.is-collapsed .pnl-body,
      .pnl-panel.is-collapsed .pnl-title{
        opacity:0; visibility:hidden; pointer-events:none; height:0; overflow:hidden;
      }
      .pnl-panel.is-collapsed::after{
        content:'◀'; position:absolute; top:50%; right:6px; transform:translateY(-50%);
        opacity:.8; font-size:16px; pointer-events:none;
      }
      .pnl-header{
        display:flex; align-items:center; justify-content:space-between; gap:8px;
        user-select:none; cursor:grab; touch-action:none; font-weight:600;
      }
      .pnl-header.is-dragging{cursor:grabbing}
      .pnl-row{display:flex; gap:8px; align-items:center; margin-top:8px}
      .pnl-button{margin:2px 0; width:140px; padding:8px 10px; border:0; border-radius:8px; cursor:pointer}
      .pnl-start{background:#22c55e; color:#000}
      .pnl-stop{background:#e5e7eb; color:#111}
      .pnl-input{width:56px; padding:5px 6px; border-radius:6px; border:none; color:#111; background:#fff}
      .pnl-note{width:100%; box-sizing:border-box; padding:7px 8px; border-radius:6px; border:none; margin-top:8px; color:#111; background:#fff}
      .pnl-tip{opacity:.82; margin-top:8px}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'pnl-panel';
    panel.innerHTML = `
      <div class="pnl-header"><span class="pnl-title">${APP.name}</span></div>
      <div class="pnl-body">
        <div class="pnl-row">
          <button id="pnl-start" class="pnl-button pnl-start">${TEXT.start}</button>
          <button id="pnl-stop" class="pnl-button pnl-stop">${TEXT.stop}</button>
        </div>
        <div class="pnl-row">
          <span>${TEXT.window}</span>
          <input id="pnl-window" class="pnl-input" type="number" min="1" value="${CONFIG.defaultWindowSec}" />
        </div>
        <label class="pnl-row" style="cursor:pointer">
          <input id="pnl-console" type="checkbox" />
          <span>${TEXT.captureConsole}</span>
        </label>
        <input id="pnl-note" class="pnl-note" placeholder="${TEXT.notePlaceholder}" />
        <div class="pnl-tip">${TEXT.tip}</div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    bindPanelEvents(panel);
  }

  function bindPanelEvents(panel) {
    const startButton = panel.querySelector('#pnl-start');
    const stopButton = panel.querySelector('#pnl-stop');
    const windowInput = panel.querySelector('#pnl-window');
    const consoleInput = panel.querySelector('#pnl-console');
    const noteInput = panel.querySelector('#pnl-note');
    const header = panel.querySelector('.pnl-header');

    let drag = null;
    let suppressClick = false;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const ensureAbsolutePosition = () => {
      if (panel.style.left) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const setExpandedPosition = () => {
      panel.classList.remove('is-collapsed');
      ensureAbsolutePosition();

      const width = CONFIG.panelWidth;
      const height = panel.offsetHeight;
      const fallback = panel.getBoundingClientRect();
      const target = state.lastExpanded || { left: fallback.left, top: fallback.top };

      const left = clamp(target.left, CONFIG.edgeVisible - width, window.innerWidth - CONFIG.edgeVisible);
      const top = clamp(target.top, CONFIG.edgeVisible - height, window.innerHeight - CONFIG.edgeVisible);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      state.lastExpanded = { left, top };
    };

    const setCollapsedPosition = () => {
      const rect = panel.getBoundingClientRect();
      state.lastExpanded = { left: rect.left, top: rect.top };
      ensureAbsolutePosition();
      panel.classList.add('is-collapsed');

      const height = panel.offsetHeight;
      const top = clamp(rect.top, CONFIG.edgeVisible - height, window.innerHeight - CONFIG.edgeVisible);
      panel.style.left = `${window.innerWidth - CONFIG.collapsedWidth}px`;
      panel.style.top = `${top}px`;
    };

    const toggleCollapse = (collapsed) => {
      state.collapsed = collapsed;
      if (collapsed) setCollapsedPosition();
      else setExpandedPosition();
    };

    const updatePanelForRecording = () => {
      startButton.disabled = state.recording;
      stopButton.disabled = !state.recording;
      startButton.textContent = state.recording ? TEXT.recording : TEXT.start;
    };

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || state.collapsed) return;
      ensureAbsolutePosition();
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: parseFloat(panel.style.left),
        top: parseFloat(panel.style.top),
        moved: false,
      };
      header.classList.add('is-dragging');
      if (panel.setPointerCapture) panel.setPointerCapture(event.pointerId);
    });

    panel.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) drag.moved = true;

      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = clamp(drag.left + dx, CONFIG.edgeVisible - width, window.innerWidth - CONFIG.edgeVisible);
      const top = clamp(drag.top + dy, CONFIG.edgeVisible - height, window.innerHeight - CONFIG.edgeVisible);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (panel.hasPointerCapture && panel.hasPointerCapture(event.pointerId)) {
        panel.releasePointerCapture(event.pointerId);
      }
      header.classList.remove('is-dragging');
      if (drag.moved) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        state.lastExpanded = {
          left: parseFloat(panel.style.left) || 0,
          top: parseFloat(panel.style.top) || 0,
        };
      }
      drag = null;
    };

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
    panel.addEventListener('lostpointercapture', endDrag);

    panel.addEventListener('click', (event) => {
      if (suppressClick) return;
      if (state.collapsed) {
        event.preventDefault();
        toggleCollapse(false);
        return;
      }
      if (!event.target.closest('.pnl-body')) toggleCollapse(true);
    });

    window.addEventListener('resize', () => {
      if (state.collapsed) setCollapsedPosition();
      else setExpandedPosition();
    });

    startButton.addEventListener('click', () => {
      state.logs.length = 0;
      state.net.length = 0;
      state.recording = true;
      state.startTS = Date.now();
      state.endTS = 0;
      state.timeWindowSec = Math.max(1, parseInt(windowInput.value || CONFIG.defaultWindowSec, 10) || CONFIG.defaultWindowSec);
      state.captureConsole = !!consoleInput.checked;
      state.actionNote = String(noteInput.value || '').trim();

      postAgentOptions();
      updatePanelForRecording();
      console.log(`[${APP.name}] ${TEXT.recordingStarted}`);
    });

    stopButton.addEventListener('click', async () => {
      state.recording = false;
      state.endTS = Date.now();
      updatePanelForRecording();

      const text = JSON.stringify(buildCapturePayload(), null, 2);

      try {
        await copyText(text);
        console.log(`[${APP.name}] ${TEXT.copied}`);
      } catch (e) {
        console.warn(`[${APP.name}] ${TEXT.copyFailed}`, e);
      }

      try {
        downloadJson(text);
      } catch (e) {
        console.warn(`[${APP.name}] ${TEXT.downloadFailed}`, e);
      }
    });

    toggleCollapse(true);
    updatePanelForRecording();
  }

  injectPageAgent();
  installMessageReceiver();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPanel);
  } else {
    renderPanel();
  }
})();
