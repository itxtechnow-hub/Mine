'use strict';

/**
 * Mine Console - Teams & Workflow Editor View
 *
 * Visual multi-model agent pipeline and tool-composition graph editor.
 * Features:
 *  - Input node (Trigger: Chat, API, Form, Webhook) -> AI Agent
 *  - AI Agent -> Boss (Planner) -> Workers -> Synthesizer -> loops back to Agent -> Output node
 *  - Universal capability sharing: Boss, all Workers, and Synthesizer all have
 *    Shared Memory, Built-in Tools, and MCP Server badges that are directly toggleable
 *  - Hover-only minimal flip/revert button inside nodes + port side selector
 *  - Auto-fit view (`⛶ Fit`) that scales and centers all nodes into the viewport
 *  - Built-in tools (grep, powershell, file_view, file_edit, web_fetch, system_info) + env check
 *  - MCP (Model Context Protocol) server support + auto-instructions
 *  - Connection Test (`⚡ Test`) with animated pulse flow
 */

window.V = window.V || {};
window.A = window.A || {};

(function () {
  const ICONS = {
    input: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="10 8 14 12 10 16"/></svg>',
    agent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="4"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg>',
    planner: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>',
    worker: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    synthesizer: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    output: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    model: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M7 7l10 10M17 7L7 17"/></svg>',
    memory: '<svg viewBox="0 0 48 48" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5"><ellipse cx="24" cy="12" rx="13" ry="5" fill="currentColor" fill-opacity="0.25"/><path d="M11 12v24c0 3 6 5 13 5s13-2 13-5V12M11 24c0 3 6 5 13 5s13-2 13-5"/></svg>',
    tool: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    mcp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'
  };

  // Mini 10x10 icons for capability badges under Boss/Workers/Synthesizer
  const MINI_ICONS = {
    memory: '<svg viewBox="0 0 48 48" width="11" height="11" stroke="currentColor" fill="none" stroke-width="4"><ellipse cx="24" cy="12" rx="13" ry="5" fill="currentColor" fill-opacity="0.3"/><path d="M11 12v24c0 3 6 5 13 5s13-2 13-5V12"/></svg>',
    tool: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    mcp: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/></svg>'
  };

  const BUILTIN_TOOLS = [
    { id: 'grep', name: 'Workspace Search (grep)', desc: 'Fast ripgrep code search across all files' },
    { id: 'powershell', name: 'PowerShell / Terminal', desc: 'Safe command execution in Windows PowerShell' },
    { id: 'file_view', name: 'File View / Read', desc: 'Read file contents and targeted line ranges' },
    { id: 'file_edit', name: 'Surgical File Edit', desc: 'Precise string replacement in code files' },
    { id: 'web_fetch', name: 'Web & API Fetch', desc: 'Fetch external documentation and web APIs' },
    { id: 'system_info', name: 'System Info Check', desc: 'Verify platform runtimes before execution' }
  ];

  const BUILTIN_MCP_SERVERS = [
    {
      id: 'filesystem',
      name: 'Filesystem (Read & Write Files)',
      category: 'File Operations',
      package: '@modelcontextprotocol/server-filesystem',
      command: 'npx -y @modelcontextprotocol/server-filesystem .',
      defaultParam: '.',
      paramLabel: 'Allowed Directory Path',
      desc: 'Enables safe file reading, directory listing, file searching, metadata inspection, and surgical file writing across allowed paths.',
      tools: 'read_file, read_multiple_files, write_file, edit_file, list_directory, directory_tree, move_file, search_files, get_file_info'
    },
    {
      id: 'fetch',
      name: 'Fetch (Web Content & API Reader)',
      category: 'Web & APIs',
      package: '@modelcontextprotocol/server-fetch',
      command: 'uvx mcp-server-fetch',
      defaultParam: '',
      paramLabel: 'Default User Agent (optional)',
      desc: 'Fetches web pages, extracts raw HTML, and converts content into clean, token-efficient Markdown for research and analysis.',
      tools: 'fetch_url, convert_html_to_markdown, read_web_page'
    },
    {
      id: 'github',
      name: 'GitHub (Repositories, PRs & Issues)',
      category: 'Development',
      package: '@modelcontextprotocol/server-github',
      command: 'npx -y @modelcontextprotocol/server-github',
      defaultParam: '',
      paramLabel: 'GitHub Personal Access Token (GITHUB_TOKEN)',
      desc: 'Full GitHub API integration: search repositories, inspect file contents, list branches, create pull requests, read issues, and review diffs.',
      tools: 'search_repositories, get_file_contents, create_or_update_file, create_pull_request, list_commits, search_code, issue_read'
    },
    {
      id: 'sqlite',
      name: 'SQLite (Database Queries & Schema)',
      category: 'Databases',
      package: '@modelcontextprotocol/server-sqlite',
      command: 'uvx mcp-server-sqlite --db-path ./data.sqlite',
      defaultParam: './data.sqlite',
      paramLabel: 'Database File Path (.sqlite or .db)',
      desc: 'Direct SQLite database inspection: analyze database schemas, inspect table structures, run SELECT queries, and execute SQL statements.',
      tools: 'read_query, write_query, create_table, list_tables, describe_table'
    },
    {
      id: 'postgres',
      name: 'PostgreSQL (Schema & Query Engine)',
      category: 'Databases',
      package: '@modelcontextprotocol/server-postgres',
      command: 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
      defaultParam: 'postgresql://localhost/mydb',
      paramLabel: 'Connection String (URL)',
      desc: 'Introspect PostgreSQL instances: inspect table schemas, analyze foreign key relations, and execute read-only queries.',
      tools: 'query, list_tables, describe_table'
    },
    {
      id: 'brave-search',
      name: 'Brave Search (Web Search API)',
      category: 'Search',
      package: '@modelcontextprotocol/server-brave-search',
      command: 'npx -y @modelcontextprotocol/server-brave-search',
      defaultParam: '',
      paramLabel: 'Brave API Key (BRAVE_API_KEY)',
      desc: 'Real-time web search and local queries via Brave Search API, returning up-to-date sources, links, and search results.',
      tools: 'brave_web_search, brave_local_search'
    },
    {
      id: 'puppeteer',
      name: 'Puppeteer (Headless Browser Automation)',
      category: 'Web & Scraping',
      package: '@modelcontextprotocol/server-puppeteer',
      command: 'npx -y @modelcontextprotocol/server-puppeteer',
      defaultParam: '',
      paramLabel: 'Browser Launch Options',
      desc: 'Controls headless Chromium: navigate dynamic JavaScript web apps, click buttons, fill forms, evaluate code, and capture screenshots.',
      tools: 'puppeteer_navigate, puppeteer_click, puppeteer_fill, puppeteer_evaluate, puppeteer_screenshot'
    },
    {
      id: 'git',
      name: 'Git (Repository History & Commits)',
      category: 'Development',
      package: 'mcp-server-git',
      command: 'uvx mcp-server-git --repository .',
      defaultParam: '.',
      paramLabel: 'Local Git Repository Path',
      desc: 'Manipulate and inspect local Git repositories: examine status, view commit log history, inspect diffs, and check out branches.',
      tools: 'git_status, git_diff, git_log, git_show, git_commit'
    },
    {
      id: 'custom',
      name: 'Custom MCP Server (stdio / command)',
      category: 'Custom',
      package: 'custom',
      command: '',
      defaultParam: '',
      paramLabel: 'Command or SSE URL',
      desc: 'Connect any custom or community Model Context Protocol server via standard I/O (stdio) or Server-Sent Events (SSE).',
      tools: 'custom_tools'
    }
  ];

  function checkSystemEnvironment() {
    const isWin = typeof navigator !== 'undefined' ? (navigator.platform || '').includes('Win') : true;
    return {
      os: isWin ? 'Windows (win32)' : 'Unix/Linux',
      shell: isWin ? 'Windows PowerShell (powershell.exe)' : '/bin/bash',
      tools: ['git', 'curl', 'node', 'npm', 'grep/ripgrep'],
      status: 'Environment Checked · Ready for tool calls'
    };
  }

  const NODE_TYPES = [
    { type: 'input', label: 'Input Trigger', sub: 'Chat / API / Form', color: '#10b981', bg: 'rgba(16,185,129,.14)', isSub: false, w: 170, h: 72 },
    { type: 'agent', label: 'AI Agent', sub: 'Coordinator & Router', color: '#f59e0b', bg: 'rgba(245,158,11,.14)', isSub: false, w: 220, h: 92 },
    { type: 'planner', label: 'Boss (Planner)', sub: 'Splits & Routes', color: '#6366f1', bg: 'rgba(99,102,241,.14)', isSub: false, w: 170, h: 78 },
    { type: 'worker', label: 'Worker', sub: 'Specialist', color: '#10b981', bg: 'rgba(16,185,129,.14)', isSub: false, w: 170, h: 80 },
    { type: 'synthesizer', label: 'Synthesizer', sub: 'Merges Outputs', color: '#3b82f6', bg: 'rgba(59,130,246,.14)', isSub: false, w: 170, h: 78 },
    { type: 'output', label: 'Output Response', sub: 'Chat / API / Webhook', color: '#ec4899', bg: 'rgba(236,72,153,.14)', isSub: false, w: 170, h: 72 },
    { type: 'model', label: 'Chat Model', sub: 'LLM Engine', color: '#8b5cf6', bg: 'rgba(139,92,246,.14)', isSub: true, port: 'model', w: 165, h: 68 },
    { type: 'memory', label: 'Shared Memory', sub: 'Context Store (Synced)', color: '#ec4899', bg: 'rgba(236,72,153,.14)', isSub: true, port: 'memory', w: 165, h: 68 },
    { type: 'tool', label: 'Built-in Tools', sub: 'Grep, Exec, Files', color: '#14b8a6', bg: 'rgba(20,184,166,.14)', isSub: true, port: 'tool', w: 165, h: 68 },
    { type: 'mcp', label: 'MCP Server', sub: 'Model Context Protocol', color: '#0ea5e9', bg: 'rgba(14,165,233,.14)', isSub: true, port: 'mcp', w: 165, h: 68 }
  ];

  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

  let editorState = {
    team: null,
    nodes: [],
    connections: [],
    selected: null,
    dragging: null,
    panning: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    testBanner: null,
    pulsing: false
  };

  function getNodeSize(n) {
    const nt = NODE_TYPES.find((t) => t.type === n.type) || NODE_TYPES[0];
    if (nt.isSub) return { w: 46, h: 46, isSub: true, circle: true };
    return { w: nt.w, h: nt.h, isSub: false, circle: false };
  }

  function getSubPortSide(n) {
    if (n.portSide) return n.portSide;
    return n.flipped ? 'bottom' : 'top';
  }

  function getHandlePos(n, side) {
    const sz = getNodeSize(n);
    if (sz.isSub) {
      const ps = getSubPortSide(n);
      if (ps === 'bottom') return { x: n.x + sz.w / 2, y: n.y + sz.h, dir: 'bottom' };
      if (ps === 'left') return { x: n.x, y: n.y + sz.h / 2, dir: 'left' };
      if (ps === 'right') return { x: n.x + sz.w, y: n.y + sz.h / 2, dir: 'right' };
      return { x: n.x + sz.w / 2, y: n.y, dir: 'top' };
    }
    if (n.type === 'agent') {
      if (side === 'input') return { x: n.x, y: n.y + 30, dir: 'left' };
      if (side === 'output') return { x: n.x, y: n.y + 62, dir: 'left' };
      if (side === 'to-planner') return { x: n.x + sz.w, y: n.y + 30, dir: 'right' };
      if (side === 'from-synth') return { x: n.x + sz.w / 2, y: n.y, dir: 'top' };
      if (side === 'left') return { x: n.x, y: n.y + 30, dir: 'left' };
      if (side === 'right') return { x: n.x + sz.w, y: n.y + 30, dir: 'right' };
      if (side === 'model') return { x: n.x + 35, y: n.y + sz.h, dir: 'bottom' };
      if (side === 'memory') return { x: n.x + 80, y: n.y + sz.h, dir: 'bottom' };
      if (side === 'tool') return { x: n.x + 135, y: n.y + sz.h, dir: 'bottom' };
      if (side === 'mcp') return { x: n.x + 185, y: n.y + sz.h, dir: 'bottom' };
      return { x: n.x + sz.w / 2, y: n.y + sz.h, dir: 'bottom' };
    }
    if (n.type === 'planner' || n.type === 'worker' || n.type === 'synthesizer') {
      const inX = n.flipped ? n.x + sz.w : n.x;
      const outX = n.flipped ? n.x : n.x + sz.w;
      if (side === 'top' || (n.type === 'synthesizer' && side === 'top')) return { x: n.x + sz.w / 2, y: n.y, dir: 'top' };
      if (side === 'left' || side === 'in') return { x: inX, y: n.y + 36, dir: n.flipped ? 'right' : 'left' };
      if (side === 'right' || side === 'out') return { x: outX, y: n.y + 36, dir: n.flipped ? 'left' : 'right' };
      if (side === 'memory' || side === 'bottom') return { x: n.x + sz.w - 18, y: n.y + sz.h, dir: 'bottom' };
      return { x: n.x + sz.w / 2, y: n.y + sz.h, dir: 'bottom' };
    }
    if (n.type === 'input') {
      const outX = n.flipped ? n.x : n.x + sz.w;
      return { x: outX, y: n.y + sz.h / 2, dir: n.flipped ? 'left' : 'right' };
    }
    if (n.type === 'output') {
      const inX = n.flipped ? n.x + sz.w : n.x;
      return { x: inX, y: n.y + sz.h / 2, dir: n.flipped ? 'right' : 'left' };
    }
    const inX = n.flipped ? n.x + sz.w : n.x;
    const outX = n.flipped ? n.x : n.x + sz.w;
    if (side === 'left' || side === 'in') return { x: inX, y: n.y + sz.h / 2, dir: n.flipped ? 'right' : 'left' };
    if (side === 'right' || side === 'out') return { x: outX, y: n.y + sz.h / 2, dir: n.flipped ? 'left' : 'right' };
    if (side === 'top') return { x: n.x + sz.w / 2, y: n.y, dir: 'top' };
    return { x: n.x + sz.w / 2, y: n.y + sz.h, dir: 'bottom' };
  }

  function edgePath(a, b, conn) {
    const aSz = getNodeSize(a);
    const bSz = getNodeSize(b);

    // Sub-node to Agent, Boss, Worker, or Synthesizer
    if (aSz.isSub) {
      const p1 = getHandlePos(a, 'out');
      const p2 = getHandlePos(b, conn.tp || a.type);
      const d = Math.max(28, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4);
      const c1x = p1.dir === 'left' ? p1.x - d : p1.dir === 'right' ? p1.x + d : p1.x;
      const c1y = p1.dir === 'top' ? p1.y - d : p1.dir === 'bottom' ? p1.y + d : p1.y;
      const c2x = p2.dir === 'left' ? p2.x - d : p2.dir === 'right' ? p2.x + d : p2.x;
      const c2y = p2.dir === 'top' ? p2.y - d : p2.dir === 'bottom' ? p2.y + d : p2.y;
      return `M ${p1.x} ${p1.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }

    // Synthesizer return loop cleanly over the top back to Agent
    if (a.type === 'synthesizer' && b.type === 'agent') {
      const p1 = getHandlePos(a, 'top');
      const p2 = getHandlePos(b, 'from-synth');
      const topY = Math.min(a.y, b.y) - 85;
      return `M ${p1.x} ${p1.y} C ${p1.x} ${topY} ${p2.x} ${topY} ${p2.x} ${p2.y}`;
    }

    // Agent to Output
    if (a.type === 'agent' && b.type === 'output') {
      const p1 = getHandlePos(a, 'output');
      const p2 = getHandlePos(b, 'left');
      const d = Math.max(30, Math.abs(p2.x - p1.x) * 0.5);
      const c1x = p1.dir === 'left' ? p1.x - d : p1.x + d;
      const c2x = p2.dir === 'right' ? p2.x + d : p2.x - d;
      return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${p2.y} ${p2.x} ${p2.y}`;
    }

    // Standard flow connection
    const p1 = getHandlePos(a, conn.fp || 'right');
    const p2 = getHandlePos(b, conn.tp || 'left');
    const d = Math.max(36, Math.abs(p2.x - p1.x) * 0.45);
    const c1x = p1.dir === 'left' ? p1.x - d : p1.x + d;
    const c2x = p2.dir === 'right' ? p2.x + d : p2.x - d;
    return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${p2.y} ${p2.x} ${p2.y}`;
  }

  // Compute capabilities available across the team
  function getAgentCapabilities() {
    const nodes = editorState.nodes || [];
    const conns = editorState.connections || [];
    const agentIds = new Set(nodes.filter((n) => n.type === 'agent').map((n) => n.id));
    const caps = {
      memory: nodes.some((n) => n.type === 'memory'),
      tool: nodes.some((n) => n.type === 'tool'),
      mcp: nodes.some((n) => n.type === 'mcp')
    };

    conns.forEach((c) => {
      if (agentIds.has(c.to)) {
        const src = nodes.find((n) => n.id === c.from);
        if (src) {
          if (src.type === 'memory') caps.memory = true;
          if (src.type === 'tool') caps.tool = true;
          if (src.type === 'mcp') caps.mcp = true;
        }
      }
    });

    return caps;
  }

  function computeFitTransform() {
    const nodes = editorState.nodes || [];
    if (!nodes.length) return { zoom: 1, panX: 0, panY: 0 };
    const svg = document.getElementById('team-canvas');
    const W = (svg && svg.clientWidth) ? svg.clientWidth : 920;
    const H = (svg && svg.clientHeight) ? svg.clientHeight : 540;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const sz = getNodeSize(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y - 40); // account for top return arc
      maxX = Math.max(maxX, n.x + sz.w);
      maxY = Math.max(maxY, n.y + sz.h + 24);
    });

    const bw = Math.max(100, maxX - minX);
    const bh = Math.max(100, maxY - minY);
    const pad = 48;
    const zoom = Math.min(1.15, Math.max(0.35, Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)));
    const panX = (W - bw * zoom) / 2 - minX * zoom;
    const panY = (H - bh * zoom) / 2 - minY * zoom;
    return { zoom, panX, panY };
  }

  function openEditor(team) {
    const editor = document.getElementById('team-editor');
    if (!editor) return;
    editor.classList.remove('hidden');

    const defaultNodes = [
      { id: 'input-1', type: 'input', triggerType: 'chat', systemPrompt: 'Accepts incoming chat messages, API calls, or form submissions.', x: 20, y: 80 },
      { id: 'output-1', type: 'output', responseType: 'chat', flipped: true, systemPrompt: 'Formats and delivers finalized answer back to chat or API client.', x: 20, y: 200 },
      { id: 'agent-1', type: 'agent', model: '', systemPrompt: 'Central coordinator. Directs tasks and connects tools, memory, and MCP.', x: 250, y: 120 },
      { id: 'planner-1', type: 'planner', model: '', permissions: { memory: true, tool: true, mcp: true }, systemPrompt: 'You are the boss. Split the user request into parts tagged by specialty and route them.', x: 530, y: 120 },
      { id: 'worker-1', type: 'worker', specialty: 'frontend', model: '', permissions: { memory: true, tool: true, mcp: true }, systemPrompt: 'Frontend Specialist. Complete the assigned UI/frontend task.', x: 770, y: 50 },
      { id: 'worker-2', type: 'worker', specialty: 'backend', model: '', permissions: { memory: true, tool: true, mcp: true }, systemPrompt: 'Backend Specialist. Complete the assigned server/data task.', x: 770, y: 190 },
      { id: 'synth-1', type: 'synthesizer', model: '', permissions: { memory: true, tool: true, mcp: true }, systemPrompt: 'You are the synthesizer. Merge all worker outputs into one coherent answer and return to Agent.', x: 1000, y: 120 },
      { id: 'model-1', type: 'model', model: 'gpt-4o-mini', x: 262, y: 250 },
      { id: 'mem-1', type: 'memory', syncWithAgent: true, windowSize: 10, systemPrompt: 'Agent shared context memory store.', x: 307, y: 250 },
      { id: 'tool-1', type: 'tool', enabledTools: ['grep', 'powershell', 'file_view', 'file_edit', 'web_fetch'], x: 362, y: 250 },
      { id: 'mcp-1', type: 'mcp', serverName: 'filesystem', param: '.', tools: 'read_file, write_file, list_directory, search_files', scope: 'all-models', systemPrompt: 'Filesystem MCP Server: Read and write workspace files safely.', x: 412, y: 250 },
      { id: 'mcp-2', type: 'mcp', serverName: 'fetch', tools: 'fetch_url, convert_html_to_markdown', scope: 'all-models', systemPrompt: 'Fetch MCP Server: Web content reader and markdown converter.', x: 468, y: 250 },
      { id: 'mcp-3', type: 'mcp', serverName: 'github', tools: 'search_repositories, get_file_contents, create_pull_request', scope: 'all-models', systemPrompt: 'GitHub MCP Server: Search repos and inspect pull requests.', x: 524, y: 250 },
      { id: 'mcp-4', type: 'mcp', serverName: 'sqlite', param: './data.sqlite', tools: 'read_query, write_query, list_tables', scope: 'all-models', systemPrompt: 'SQLite MCP Server: Query local database files.', x: 580, y: 250 }
    ];

    const defaultConns = [
      { from: 'input-1', to: 'agent-1', fp: 'out', tp: 'input' },
      { from: 'agent-1', to: 'output-1', fp: 'output', tp: 'left' },
      { from: 'agent-1', to: 'planner-1', fp: 'to-planner', tp: 'left' },
      { from: 'planner-1', to: 'worker-1', fp: 'right', tp: 'left' },
      { from: 'planner-1', to: 'worker-2', fp: 'right', tp: 'left' },
      { from: 'worker-1', to: 'synth-1', fp: 'right', tp: 'left' },
      { from: 'worker-2', to: 'synth-1', fp: 'right', tp: 'left' },
      { from: 'synth-1', to: 'agent-1', fp: 'top', tp: 'from-synth' },
      { from: 'model-1', to: 'agent-1', tp: 'model' },
      { from: 'mem-1', to: 'agent-1', tp: 'memory' },
      { from: 'tool-1', to: 'agent-1', tp: 'tool' },
      { from: 'mcp-1', to: 'agent-1', tp: 'mcp' },
      { from: 'mcp-2', to: 'agent-1', tp: 'mcp' },
      { from: 'mcp-3', to: 'agent-1', tp: 'mcp' },
      { from: 'mcp-4', to: 'agent-1', tp: 'mcp' }
    ];

    editorState = {
      team: team || { id: 'team-' + Date.now(), name: 'New team', slug: 'team-' + Date.now(), enabled: true },
      nodes: (team && team.nodes && team.nodes.length) ? team.nodes.map((n) => ({ ...n })) : defaultNodes,
      connections: (team && (team.connections || team.conns)) ? (team.connections || team.conns).map((c) => ({ ...c })) : defaultConns,
      selected: null,
      dragging: null,
      panning: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      testBanner: null,
      pulsing: false,
      mcpExpanded: false
    };

    renderEditor();
    // Auto-fit all nodes cleanly into the viewport after layout paints
    setTimeout(() => {
      const fit = computeFitTransform();
      editorState.zoom = fit.zoom;
      editorState.panX = fit.panX;
      editorState.panY = fit.panY;
      renderEditor();
    }, 20);
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeEditor() {
    const editor = document.getElementById('team-editor');
    if (editor) editor.classList.add('hidden');
    editorState = { team: null, nodes: [], connections: [], selected: null, dragging: null, panning: false, zoom: 1, panX: 0, panY: 0, testBanner: null, pulsing: false, mcpExpanded: false };
  }

  function getConnectedAgentModel(nodes, conns) {
    const agent = nodes.find((x) => x.type === 'agent');
    if (!agent) return '';
    const modelConn = conns.find((c) => c.to === agent.id && (c.tp === 'model' || c.tp === 'main'));
    if (modelConn) {
      const modelNode = nodes.find((x) => x.id === modelConn.from && x.type === 'model');
      if (modelNode && modelNode.model) return modelNode.model;
    }
    const anyModelNode = nodes.find((x) => x.type === 'model' && x.model);
    if (anyModelNode) return anyModelNode.model;
    return agent.model || '';
  }

  function renderNode(n, agentCaps) {
    const nt = NODE_TYPES.find((t) => t.type === n.type) || NODE_TYPES[0];
    const isSel = editorState.selected === n.id;
    const sz = getNodeSize(n);
    const strokeColor = isSel ? nt.color : 'var(--line-strong)';
    const strokeW = isSel ? 2.5 : 1.5;

    // Sub-nodes connected under Agent (Model, Memory, Tool, MCP) -> Minimal circular nodes
    if (sz.isSub) {
      const ps = getSubPortSide(n);
      const px = ps === 'left' ? 0 : ps === 'right' ? sz.w : sz.w / 2;
      const py = ps === 'top' ? 0 : ps === 'bottom' ? sz.h : sz.h / 2;

      let label = nt.label.replace('Chat ', '').replace('Shared ', '').replace('Built-in ', '').replace(' Server', '');
      if (n.type === 'mcp') {
        const preset = BUILTIN_MCP_SERVERS.find((s) => s.id === (n.serverName || 'filesystem'));
        label = preset ? preset.name.split(' ')[0] : (n.serverName || 'MCP');
      } else if (n.type === 'model') {
        const mName = n.model ? n.model.split('/').pop() : '';
        if (mName && mName.length <= 11) label = mName;
      }
      if (n.name) label = n.name;

      return `
        <g class="team-node ${isSel ? 'selected' : ''}" data-id="${escapeAttr(n.id)}" transform="translate(${n.x || 0},${n.y || 0})">
          <circle cx="${sz.w / 2}" cy="${sz.h / 2}" r="${sz.w / 2}" fill="var(--sf)" stroke="${strokeColor}" stroke-width="${strokeW}"/>
          <circle cx="${sz.w / 2}" cy="${sz.h / 2}" r="${sz.w / 2 - 4}" fill="${nt.bg}"/>
          <g transform="translate(${sz.w / 2 - 9}, ${sz.h / 2 - 9})" fill="${nt.color}" stroke="${nt.color}">
            ${ICONS[n.type] || ICONS.agent}
          </g>
          <text x="${sz.w / 2}" y="${sz.h + 13}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${nt.color}">${escapeHtml(label)}</text>
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="${ps}" cx="${px}" cy="${py}" r="4.5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
          <g class="node-flip-btn" data-flip="${escapeAttr(n.id)}" transform="translate(${sz.w - 12}, -6)">
            <rect width="16" height="16" rx="4" fill="var(--sf)" stroke="var(--line-strong)" stroke-width="1"/>
            <text x="8" y="11.5" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">⇄</text>
          </g>
        </g>
      `;
    }

    const connectedModel = getConnectedAgentModel(editorState.nodes, editorState.connections);
    let modelText = nt.sub;
    if (n.type === 'agent') {
      modelText = connectedModel ? 'Engine: ' + connectedModel.split('/').pop() : 'Engine: (model-1)';
    } else if (n.model) {
      modelText = n.model.split('/').pop();
    } else if (n.specialty) {
      modelText = 'Specialty: ' + n.specialty;
    }
    const iconSvg = ICONS[n.type] || ICONS.agent;

    let handles = '';
    if (n.type === 'agent') {
      handles = `
        <g transform="translate(0, 30)">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="input" cx="0" cy="0" r="5" fill="#fff" stroke="#10b981" stroke-width="2"/>
          <text x="-8" y="3" text-anchor="end" font-size="8.5" font-weight="700" fill="#10b981">In</text>
        </g>
        <g transform="translate(0, 62)">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="output" cx="0" cy="0" r="5" fill="#fff" stroke="#ec4899" stroke-width="2"/>
          <text x="-8" y="3" text-anchor="end" font-size="8.5" font-weight="700" fill="#ec4899">Out</text>
        </g>
        <g transform="translate(${sz.w}, 30)">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="to-planner" cx="0" cy="0" r="5" fill="#fff" stroke="#6366f1" stroke-width="2"/>
          <text x="8" y="3" text-anchor="start" font-size="8.5" font-weight="700" fill="#6366f1">Boss</text>
        </g>
        <g transform="translate(${sz.w / 2}, 0)">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="from-synth" cx="0" cy="0" r="5" fill="#fff" stroke="#3b82f6" stroke-width="2"/>
          <text y="-8" text-anchor="middle" font-size="8.5" font-weight="700" fill="#3b82f6">Synth Return</text>
        </g>
        <g transform="translate(35, ${sz.h})">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="model" cx="0" cy="0" r="4.5" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
          <text y="12" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--text-muted)">Model</text>
        </g>
        <g transform="translate(80, ${sz.h})">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="memory" cx="0" cy="0" r="4.5" fill="#fff" stroke="#ec4899" stroke-width="2"/>
          <text y="12" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--text-muted)">Memory</text>
        </g>
        <g transform="translate(135, ${sz.h})">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="tool" cx="0" cy="0" r="4.5" fill="#fff" stroke="#14b8a6" stroke-width="2"/>
          <text y="12" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--text-muted)">Tools</text>
        </g>
        <g transform="translate(185, ${sz.h})">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="mcp" cx="0" cy="0" r="4.5" fill="#fff" stroke="#0ea5e9" stroke-width="2"/>
          <text y="12" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--text-muted)">MCP</text>
        </g>
      `;
    } else if (n.type === 'planner' || n.type === 'worker' || n.type === 'synthesizer') {
      const inX = n.flipped ? sz.w : 0;
      const outX = n.flipped ? 0 : sz.w;
      handles = `
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="left" cx="${inX}" cy="36" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="right" cx="${outX}" cy="36" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
        <g transform="translate(${sz.w - 18}, ${sz.h})">
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="memory" cx="0" cy="0" r="4.5" fill="#fff" stroke="#ec4899" stroke-width="2"/>
        </g>
        ${n.type === 'synthesizer' ? `
          <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="top" cx="${sz.w / 2}" cy="0" r="5" fill="#fff" stroke="#3b82f6" stroke-width="2"/>
        ` : ''}
      `;
    } else if (n.type === 'input') {
      const outX = n.flipped ? 0 : sz.w;
      handles = `
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="right" cx="${outX}" cy="${sz.h / 2}" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
      `;
    } else if (n.type === 'output') {
      const inX = n.flipped ? sz.w : 0;
      handles = `
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="left" cx="${inX}" cy="${sz.h / 2}" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
      `;
    } else {
      const inX = n.flipped ? sz.w : 0;
      const outX = n.flipped ? 0 : sz.w;
      handles = `
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="left" cx="${inX}" cy="${sz.h / 2}" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
        <circle class="handle" data-node="${escapeAttr(n.id)}" data-side="right" cx="${outX}" cy="${sz.h / 2}" r="5" fill="#fff" stroke="${nt.color}" stroke-width="2"/>
      `;
    }

    // Shared capability badges under Boss, Workers, and Synthesizer (Memory, Tools, MCP)
    let capBadges = '';
    if (n.type === 'planner' || n.type === 'worker' || n.type === 'synthesizer') {
      const perms = n.permissions || {};
      const badges = [];
      if (agentCaps.memory) badges.push({ key: 'memory', color: '#ec4899', enabled: perms.memory !== false, title: 'Shared Memory' });
      if (agentCaps.tool) badges.push({ key: 'tool', color: '#14b8a6', enabled: perms.tool !== false, title: 'Built-in Tools' });
      if (agentCaps.mcp) badges.push({ key: 'mcp', color: '#0ea5e9', enabled: perms.mcp !== false, title: 'MCP Server' });

      if (badges.length) {
        const startX = 18;
        capBadges = badges.map((b, idx) => {
          const bx = startX + idx * 25;
          const by = sz.h - 1;
          return `
            <g class="cap-badge ${b.enabled ? 'active' : 'disabled'}" data-cap-node="${escapeAttr(n.id)}" data-cap="${b.key}" transform="translate(${bx}, ${by})">
              <title>${b.title}: ${b.enabled ? 'Active (click to disable)' : 'Disabled (click to enable)'}</title>
              <circle cx="0" cy="0" r="10" fill="${b.enabled ? b.color : 'var(--sf)'}" stroke="${b.enabled ? 'var(--sf)' : 'var(--line-strong)'}" stroke-width="${b.enabled ? 1.5 : 1.2}" stroke-dasharray="${b.enabled ? 'none' : '2 2'}"/>
              <g transform="translate(-5.5, -5.5)" stroke="${b.enabled ? '#fff' : 'var(--text-muted)'}" fill="${b.enabled ? '#fff' : 'var(--text-muted)'}">
                ${MINI_ICONS[b.key]}
              </g>
              ${b.enabled ? '' : '<line x1="-6" y1="-6" x2="6" y2="6" stroke="var(--bad)" stroke-width="1.8" stroke-linecap="round"/>'}
            </g>
          `;
        }).join('');
      }
    }

    return `
      <g class="team-node ${isSel ? 'selected' : ''}" data-id="${escapeAttr(n.id)}" transform="translate(${n.x || 0},${n.y || 0})">
        <rect width="${sz.w}" height="${sz.h}" rx="12" fill="var(--sf)" stroke="${strokeColor}" stroke-width="${strokeW}"/>
        <g transform="translate(8, 12)">
          <rect width="32" height="32" rx="8" fill="${nt.bg}" stroke="${nt.color}" stroke-opacity="0.3" stroke-width="1"/>
          <g transform="translate(7, 7)" fill="${nt.color}" stroke="${nt.color}">
            ${iconSvg}
          </g>
        </g>
        <g transform="translate(48, 12)">
          <text x="0" y="13" font-size="11.5" font-weight="800" fill="var(--text)">${escapeHtml(n.name || nt.label)}</text>
          <text x="0" y="27" font-size="9.5" font-weight="600" fill="${nt.color}">${escapeHtml(modelText)}</text>
          <text x="0" y="39" font-size="8.5" fill="var(--text-muted)" class="mono">${escapeHtml(n.id)}</text>
        </g>
        <g class="node-flip-btn" data-flip="${escapeAttr(n.id)}" transform="translate(${sz.w - 22}, 5)">
          <title>Flip / Revert port side</title>
          <rect width="17" height="17" rx="5" fill="var(--chip)" stroke="var(--line)" stroke-width="1"/>
          <text x="8.5" y="12" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">⇄</text>
        </g>
        ${handles}
        ${capBadges}
      </g>
    `;
  }

  function renderMcpCluster(anchorNode, mcpNodes) {
    const isSel = mcpNodes.some((m) => editorState.selected === m.id);
    const strokeColor = isSel ? '#0ea5e9' : 'var(--line-strong)';
    return `
      <g class="team-node mcp-cluster ${isSel ? 'selected' : ''}" data-id="${escapeAttr(anchorNode.id)}" data-a="toggle-mcp-cluster" transform="translate(${anchorNode.x || 412},${anchorNode.y || 250})">
        <title>Connected MCP Servers (${mcpNodes.length}): ${mcpNodes.map(m => m.name || m.serverName || 'server').join(', ')} - Click to expose all</title>
        <circle cx="28" cy="28" r="23" fill="var(--sf)" stroke="rgba(14,165,233,.3)" stroke-width="1.5"/>
        <circle cx="25" cy="25" r="23" fill="var(--sf)" stroke="rgba(14,165,233,.5)" stroke-width="1.5"/>
        <circle cx="23" cy="23" r="23" fill="var(--sf)" stroke="${strokeColor}" stroke-width="${isSel ? 2.5 : 2}"/>
        <circle cx="23" cy="23" r="19" fill="rgba(14,165,233,.14)"/>
        <g transform="translate(14, 14)" fill="#0ea5e9" stroke="#0ea5e9">
          ${ICONS.mcp}
        </g>
        <g transform="translate(36, 6)">
          <circle cx="0" cy="0" r="8" fill="#0ea5e9" stroke="var(--sf)" stroke-width="1.5"/>
          <text x="0" y="3" text-anchor="middle" font-size="8.5" font-weight="800" fill="#fff">${mcpNodes.length}</text>
        </g>
        <text x="23" y="60" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0ea5e9">MCP (${mcpNodes.length}) ▾</text>
        <circle class="handle" data-node="${escapeAttr(anchorNode.id)}" data-side="top" cx="23" cy="0" r="4.5" fill="#fff" stroke="#0ea5e9" stroke-width="2"/>
      </g>
    `;
  }

  function renderNodesMarkup(agentCaps) {
    const mcpNodes = editorState.nodes.filter((n) => n.type === 'mcp');
    const collapseMcp = mcpNodes.length > 3 && !editorState.mcpExpanded;
    let mcpClusterDone = false;

    let out = editorState.nodes.map((n) => {
      if (collapseMcp && n.type === 'mcp') {
        if (!mcpClusterDone) {
          mcpClusterDone = true;
          return renderMcpCluster(n, mcpNodes);
        }
        return '';
      }
      return renderNode(n, agentCaps);
    }).join('');

    if (!collapseMcp && mcpNodes.length > 3) {
      out += `
        <g class="mcp-collapse-btn" data-a="collapse-mcp" transform="translate(${mcpNodes[0].x - 6}, ${mcpNodes[0].y - 20})">
          <title>Click to collapse MCP nodes into one compact cluster</title>
          <rect width="82" height="17" rx="5" fill="var(--chip)" stroke="#0ea5e9" stroke-width="1"/>
          <text x="41" y="11.5" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0ea5e9">▲ Collapse (${mcpNodes.length})</text>
        </g>
      `;
    }

    return out;
  }

  function renderConnections() {
    const nodes = editorState.nodes;
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    const conns = editorState.connections || [];
    const mcpNodes = nodes.filter((n) => n.type === 'mcp');
    const collapseMcp = mcpNodes.length > 3 && !editorState.mcpExpanded;
    let mcpConnDrawn = false;
    let svg = '';

    conns.forEach((c, i) => {
      const a = byId[c.from], b = byId[c.to];
      if (!a || !b) return;

      if (collapseMcp) {
        if (a.type === 'mcp' && b.type === 'agent') {
          if (mcpConnDrawn) return;
          mcpConnDrawn = true;
          const d = edgePath(mcpNodes[0], b, { fp: 'top', tp: 'mcp' });
          svg += `<path id="edge-${i}" d="${d}" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="5 4" fill="none" marker-end="url(#dot-marker)" class="edge-path ${editorState.pulsing ? 'pulsing' : ''}" style="cursor:pointer" data-edge="${i}"/>`;
          return;
        }
      }

      const d = edgePath(a, b, c);
      const isSub = (getNodeSize(a).isSub || getNodeSize(b).isSub);
      const isLoop = (a.type === 'synthesizer' && b.type === 'agent');
      const isInput = (a.type === 'input' || b.type === 'output');
      let color = 'var(--accent-strong)';
      if (isSub) {
        color = a.type === 'memory' ? '#ec4899' : a.type === 'tool' ? '#14b8a6' : a.type === 'mcp' ? '#0ea5e9' : '#8b5cf6';
      } else if (isLoop) {
        color = '#3b82f6';
      } else if (isInput) {
        color = '#10b981';
      }

      const dash = isSub ? 'stroke-dasharray="5 4"' : isLoop ? 'stroke-dasharray="6 3"' : '';
      const marker = isSub ? 'marker-end="url(#dot-marker)"' : 'marker-end="url(#arrow-marker)"';
      const pulsingClass = editorState.pulsing ? 'pulsing' : '';
      svg += `<path id="edge-${i}" d="${d}" stroke="${color}" stroke-width="2" ${dash} fill="none" ${marker} class="edge-path ${pulsingClass}" style="cursor:pointer" data-edge="${i}"/>`;
    });

    const defs = `
      <defs>
        <marker id="arrow-marker" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,1 L0,7 L7,4 z" fill="var(--accent-strong)"/>
        </marker>
        <marker id="dot-marker" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <circle cx="3" cy="3" r="2.5" fill="var(--accent)"/>
        </marker>
      </defs>
    `;
    return defs + svg;
  }

  function updateArrowPaths() {
    const svg = document.getElementById('team-canvas');
    if (!svg) return;
    const byId = {};
    editorState.nodes.forEach((n) => { byId[n.id] = n; });
    const conns = editorState.connections || [];
    conns.forEach((c, i) => {
      const a = byId[c.from], b = byId[c.to];
      if (!a || !b) return;
      const d = edgePath(a, b, c);
      const el = svg.querySelector('#edge-' + i);
      if (el) el.setAttribute('d', d);
    });
  }

  function renderProps(node, modelOptions, agentCaps) {
    const nt = NODE_TYPES.find((t) => t.type === node.type) || NODE_TYPES[0];
    const env = checkSystemEnvironment();
    const perms = node.permissions || {};
    const connectedModel = getConnectedAgentModel(editorState.nodes, editorState.connections);

    return `
      <div class="props">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <b style="font-size:14px;color:var(--text)">${escapeHtml(node.id)}</b>
          <span class="chip" style="background:${nt.bg};color:${nt.color}">${escapeHtml(nt.label)}</span>
        </div>

        <label class="lbl">Node Custom Name / Label</label>
        <input class="input" id="prop-node-name" data-a="prop-name" data-id="${escapeAttr(node.id)}" value="${escapeAttr(node.name || '')}" placeholder="e.g. ${escapeAttr(nt.label)}">

        <label class="lbl">Component Type</label>
        <select class="input" data-a="prop-type" data-id="${escapeAttr(node.id)}">
          ${NODE_TYPES.map((t) => `<option value="${t.type}" ${node.type === t.type ? 'selected' : ''}>${t.label} (${t.sub})</option>`).join('')}
        </select>

        ${getNodeSize(node).isSub ? `
          <label class="lbl">Port Side (Placement)</label>
          <select class="input" id="prop-port-side">
            <option value="top" ${getSubPortSide(node) === 'top' ? 'selected' : ''}>Top</option>
            <option value="right" ${getSubPortSide(node) === 'right' ? 'selected' : ''}>Right</option>
            <option value="bottom" ${getSubPortSide(node) === 'bottom' ? 'selected' : ''}>Bottom</option>
            <option value="left" ${getSubPortSide(node) === 'left' ? 'selected' : ''}>Left</option>
          </select>
        ` : `
          <div class="perm-row">
            <span>Flip / Revert Port Side</span>
            <button class="btn sm" data-a="flip-node" data-id="${escapeAttr(node.id)}">⇄ Flip</button>
          </div>
        `}

        ${(node.type === 'planner' || node.type === 'worker' || node.type === 'synthesizer') ? `
          <label class="lbl" style="margin-top:4px">Model Permissions &amp; Access</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div class="perm-row">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ec4899"></span>
                <span>Shared Memory Context</span>
              </div>
              <input type="checkbox" class="tool-checkbox" data-a="toggle-perm" data-cap="memory" data-id="${escapeAttr(node.id)}" ${perms.memory !== false ? 'checked' : ''}>
            </div>
            <div class="perm-row">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#14b8a6"></span>
                <span>Built-in Tools (grep, powershell, files)</span>
              </div>
              <input type="checkbox" class="tool-checkbox" data-a="toggle-perm" data-cap="tool" data-id="${escapeAttr(node.id)}" ${perms.tool !== false ? 'checked' : ''}>
            </div>
            <div class="perm-row">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0ea5e9"></span>
                <span>MCP Server Tools</span>
              </div>
              <input type="checkbox" class="tool-checkbox" data-a="toggle-perm" data-cap="mcp" data-id="${escapeAttr(node.id)}" ${perms.mcp !== false ? 'checked' : ''}>
            </div>
          </div>
        ` : ''}

        ${node.type === 'input' ? `
          <label class="lbl">Trigger Source</label>
          <select class="input" id="prop-trigger-type">
            <option value="chat" ${node.triggerType === 'chat' ? 'selected' : ''}>Chat Message Point</option>
            <option value="api" ${node.triggerType === 'api' ? 'selected' : ''}>API Call Gateway (/v1/chat/completions)</option>
            <option value="form" ${node.triggerType === 'form' ? 'selected' : ''}>Google Form / Survey Submission</option>
            <option value="webhook" ${node.triggerType === 'webhook' ? 'selected' : ''}>Incoming Webhook Point</option>
          </select>
        ` : ''}

        ${node.type === 'output' ? `
          <label class="lbl">Output Delivery Channel</label>
          <select class="input" id="prop-response-type">
            <option value="chat" ${node.responseType === 'chat' ? 'selected' : ''}>Streaming Chat Response</option>
            <option value="api" ${node.responseType === 'api' ? 'selected' : ''}>Standard OpenAI API JSON</option>
            <option value="markdown" ${node.responseType === 'markdown' ? 'selected' : ''}>Markdown Formatted Text</option>
            <option value="webhook" ${node.responseType === 'webhook' ? 'selected' : ''}>Return Webhook Payload</option>
          </select>
        ` : ''}

        ${node.type === 'agent' ? `
          <label class="lbl">LLM Engine</label>
          <div class="perm-row">
            <div>
              <div style="font-weight:700;font-size:12px">Chat Model Connection</div>
              <div class="tool-desc">Powered by connected Chat Model node: <b>${escapeHtml(connectedModel ? connectedModel.split('/').pop() : 'model-1')}</b></div>
            </div>
            <span class="chip ok" style="font-size:11px">${escapeHtml(connectedModel ? connectedModel.split('/').pop() : 'model-1')}</span>
          </div>
        ` : ''}

        ${(node.type === 'planner' || node.type === 'worker' || node.type === 'synthesizer' || node.type === 'model') ? `
          <label class="lbl">${node.type === 'model' ? 'Model Provider &amp; Model ID' : 'Assigned Model'}</label>
          <select class="input" data-a="prop-model" data-id="${escapeAttr(node.id)}">
            <option value="">(Use Model Queue fallback)</option>
            ${modelOptions}
          </select>
        ` : ''}

        ${node.type === 'worker' ? `
          <label class="lbl">Worker Specialty</label>
          <input class="input" data-a="prop-specialty" data-id="${escapeAttr(node.id)}" value="${escapeAttr(node.specialty || '')}" placeholder="e.g. frontend, backend, test, review">
        ` : ''}

        ${node.type === 'memory' ? `
          <div style="background:var(--sf);border:1px solid var(--line);border-radius:10px;padding:12px;margin:4px 0;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-weight:700;font-size:12px">Sync with Agent Memory</span>
              <input type="checkbox" class="tool-checkbox" data-a="sync-memory" data-id="${escapeAttr(node.id)}" ${node.syncWithAgent !== false ? 'checked' : ''}>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-weight:700;font-size:12px">Compact Circle Icon</span>
              <input type="checkbox" class="tool-checkbox" data-a="toggle-compact" data-id="${escapeAttr(node.id)}" ${node.compact ? 'checked' : ''}>
            </div>
            <p class="mute" style="font-size:11px;margin:0;line-height:1.4">
              Work completed by previous models is stored into the shared context bus so subsequent workers inherit full context without restarting.
            </p>
          </div>
        ` : ''}

        ${node.type === 'tool' ? `
          <div class="env-pill">
            <span class="live-dot"></span>
            <span>${escapeHtml(env.shell)} · Ready</span>
          </div>

          <label class="lbl" style="margin-top:6px">Built-in Tools Enabled</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${BUILTIN_TOOLS.map((tool) => {
              const isEnabled = (node.enabledTools || ['grep', 'powershell', 'file_view', 'file_edit', 'web_fetch']).includes(tool.id);
              return `
                <div class="tool-item">
                  <input type="checkbox" class="tool-checkbox" data-a="toggle-tool" data-tool="${escapeAttr(tool.id)}" data-id="${escapeAttr(node.id)}" ${isEnabled ? 'checked' : ''}>
                  <div>
                    <div style="font-weight:700;font-size:11.5px">${escapeHtml(tool.name)}</div>
                    <div class="tool-desc">${escapeHtml(tool.desc)}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${node.type === 'mcp' ? `
          <label class="lbl">Built-in MCP Server</label>
          <select class="input" id="prop-mcp-preset">
            ${BUILTIN_MCP_SERVERS.map((s) => `
              <option value="${s.id}" ${(node.serverName || 'filesystem') === s.id ? 'selected' : ''}>
                ${s.name} [${s.category}]
              </option>
            `).join('')}
          </select>

          ${(() => {
            const currentPreset = BUILTIN_MCP_SERVERS.find((s) => s.id === (node.serverName || 'filesystem')) || BUILTIN_MCP_SERVERS[0];
            return `
              <div class="mcp-box">
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span class="chip ok" style="font-size:11px">⚡ ${escapeHtml(currentPreset.name.split('(')[0].trim())}</span>
                  <span class="mono mute" style="font-size:10px">${escapeHtml(currentPreset.category)}</span>
                </div>
                <div class="mcp-desc">${escapeHtml(currentPreset.desc)}</div>
                ${currentPreset.command ? `
                  <div style="font-size:10.5px;color:var(--text-muted)">
                    <b>Command:</b> <code class="mono">${escapeHtml(currentPreset.command)}</code>
                  </div>
                ` : ''}
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">
                  ${(node.tools || currentPreset.tools).split(',').map((t) => `<span class="mcp-tool-pill">${escapeHtml(t.trim())}</span>`).join('')}
                </div>
              </div>

              <label class="lbl" style="margin-top:6px">${escapeHtml(currentPreset.paramLabel || 'Target / Parameters')}</label>
              <input class="input" id="prop-mcp-param" value="${escapeAttr(node.param !== undefined ? node.param : currentPreset.defaultParam)}" placeholder="e.g. . or connection URL">
            `;
          })()}

          <label class="lbl" style="margin-top:6px">MCP Scope</label>
          <select class="input" id="prop-mcp-scope">
            <option value="all-models" ${node.scope !== 'agent' ? 'selected' : ''}>Available to All Models (Boss &amp; Workers)</option>
            <option value="agent" ${node.scope === 'agent' ? 'selected' : ''}>Agent Coordinator Only</option>
          </select>
        ` : ''}

        <label class="lbl">Instructions / System Prompt</label>
        <textarea class="input" data-a="prop-prompt" data-id="${escapeAttr(node.id)}" rows="4" placeholder="Specific instructions for this node...">${escapeHtml(node.systemPrompt || '')}</textarea>

        <label class="lbl">Description / Context</label>
        <textarea class="input" data-a="prop-desc" data-id="${escapeAttr(node.id)}" rows="3" placeholder="Notes, constraints, or context...">${escapeHtml(node.description || '')}</textarea>

        <div class="row" style="margin-top:14px;gap:8px;justify-content:space-between">
          <button class="btn sm danger" data-a="delete-node" data-id="${escapeAttr(node.id)}">Delete node</button>
          <button class="btn sm primary" data-a="save-node" data-id="${escapeAttr(node.id)}">Save edit to node</button>
        </div>
      </div>
    `;
  }

  function renderEditor() {
    const editor = document.getElementById('team-editor');
    if (!editor) return;
    const S = window.S || {};
    const allModels = (S.fetchedModels || S.models || []).filter((m) => m && m.id);
    const queueIds = (S.modelQueue || []).map((m) => typeof m === 'string' ? m : (m && (m.id || m.model))).filter(Boolean);
    const assignedTo = {};
    editorState.nodes.forEach((n) => { if (n.model) (assignedTo[n.model] = assignedTo[n.model] || []).push(n.id); });
    const selectedNode = editorState.selected ? editorState.nodes.find((n) => n.id === editorState.selected) : null;
    const models = allModels.filter((m) => queueIds.includes(m.id) || queueIds.includes(m.rawId) || (assignedTo[m.id] || []).length);
    const modelOptions = models.map((m) => {
      const owners = assignedTo[m.id] || [];
      const queued = queueIds.includes(m.id) || queueIds.includes(m.rawId);
      const label = m.id + (owners.length ? ' — Assigned: ' + owners.join(', ') : '') + (queued ? ' — Queue' : '');
      return `<option value="${escapeAttr(m.id)}" ${(selectedNode && selectedNode.model === m.id) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    const agentCaps = getAgentCapabilities();
    const conns = editorState.connections || [];
    const freeNodes = editorState.nodes.filter((n) => !conns.some((c) => c.from === n.id || c.to === n.id));

    editor.innerHTML = `
      <div class="team-editor-bar">
        <input class="input" id="te-name" value="${escapeAttr(editorState.team.name)}" placeholder="Team name" style="max-width:180px">
        <div class="mono" style="font-size:12px;display:flex;align-items:center;gap:4px">
          <span class="mute">mine/agent/</span>
          <input class="input" id="te-slug" value="${escapeAttr(editorState.team.slug)}" placeholder="slug" style="max-width:130px">
        </div>

        <div class="row" style="gap:5px;flex-wrap:wrap">
          <button class="btn sm" data-a="add-node" data-type="input">+ Input</button>
          <button class="btn sm" data-a="add-node" data-type="agent">+ Agent</button>
          <button class="btn sm" data-a="add-node" data-type="planner">+ Boss</button>
          <button class="btn sm" data-a="add-node" data-type="worker">+ Worker</button>
          <button class="btn sm" data-a="add-node" data-type="synthesizer">+ Synth</button>
          <button class="btn sm" data-a="add-node" data-type="output">+ Output</button>
          <button class="btn sm" data-a="add-node" data-type="model">+ Model</button>
          <button class="btn sm" data-a="add-node" data-type="memory">+ Memory</button>
          <button class="btn sm" data-a="add-node" data-type="tool">+ Tool</button>
          <button class="btn sm" data-a="add-node" data-type="mcp">+ MCP</button>
        </div>

        <div class="row" style="margin-left:auto;gap:6px">
          <button class="btn sm" data-a="test-team" title="Test workflow connections and data flow">⚡ Test</button>
          <button class="btn sm d" data-a="cancel-team">Close</button>
          <button class="btn sm primary" data-a="save-team">Save team</button>
        </div>
      </div>

      <div class="team-canvas-wrap">
        <div style="position:relative;display:flex;flex-direction:column">
          ${editorState.testBanner ? `
            <div style="position:absolute;top:12px;left:14px;right:14px;z-index:20;display:flex;justify-content:center">
              <div class="test-badge ${editorState.testBanner.type}">${escapeHtml(editorState.testBanner.text)}</div>
            </div>
          ` : ''}
          <svg class="team-canvas ${editorState.panning ? 'panning' : ''}" id="team-canvas" width="100%" height="560">
            <g id="canvas-g" transform="translate(${editorState.panX || 0},${editorState.panY || 0}) scale(${editorState.zoom || 1})" style="transform-origin:0 0;">
              ${renderConnections()}
              ${renderNodesMarkup(agentCaps)}
            </g>
          </svg>
          <div class="row" style="margin-top:8px;align-items:center;justify-content:space-between">
            <div class="row" style="gap:4px">
              <button class="btn sm" data-a="zoom-out">−</button>
              <button class="btn sm" data-a="zoom-in">+</button>
              <button class="btn sm" data-a="fit-view">⛶ Fit</button>
            </div>
            <span class="team-hint mute">${freeNodes.length ? `⚠ ${freeNodes.length} free node(s): ${freeNodes.map(n => n.id).join(', ')} (connect to integrate).` : '✔ 0 free nodes — all nodes connected.'} Click [Mem], [Tools], [MCP] to toggle permissions.</span>
          </div>
        </div>

        <div class="team-props">
          ${selectedNode ? renderProps(selectedNode, modelOptions, agentCaps) : `
            <div style="color:var(--text-muted);font-size:12.5px;line-height:1.6">
              <b style="color:var(--text);display:block;margin-bottom:6px">Agent &amp; Team Architecture</b>
              <p style="margin:0 0 10px">Select any node on the canvas to configure its model, prompts, port placement, and permissions.</p>
              <div style="padding:10px;background:var(--sf);border-radius:8px;border:1px solid var(--line);margin-bottom:8px">
                <b>Input Trigger</b>: Chat, API call, Google Form.<br>
                <b>AI Agent</b>: Coordinates tools, memory &amp; workers.<br>
                <b>Boss, Workers &amp; Synth</b>: All share Memory, Tools &amp; MCP (toggleable per node).<br>
                <b>Synthesizer</b>: Merges responses and loops back to Agent.<br>
                <b>Output Response</b>: Delivers final result to chat/client.
              </div>
            </div>
          `}
        </div>
      </div>
    `;

    // Hover flip button click
    editor.querySelectorAll('.node-flip-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.flip;
        const node = editorState.nodes.find((x) => x.id === id);
        if (!node) return;
        if (getNodeSize(node).isSub) {
          const order = ['top', 'right', 'bottom', 'left'];
          const cur = getSubPortSide(node);
          node.portSide = order[(order.indexOf(cur) + 1) % order.length];
        } else {
          node.flipped = !node.flipped;
        }
        renderEditor();
      });
    });

    // Capability badge click directly on Boss/Worker/Synthesizer nodes
    editor.querySelectorAll('.cap-badge').forEach((badge) => {
      badge.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = badge.dataset.capNode;
        const cap = badge.dataset.cap;
        const node = editorState.nodes.find((x) => x.id === id);
        if (!node) return;
        if (!node.permissions) node.permissions = { memory: true, tool: true, mcp: true };
        node.permissions[cap] = node.permissions[cap] === false ? true : false;
        renderEditor();
      });
    });

    // Bind canvas node dragging and selection
    editor.querySelectorAll('.team-node').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        let moved = false;
        editorState.dragging = id;
        editorState.selected = id;
        const n = editorState.nodes.find((x) => x.id === id);
        const clickX = e.clientX;
        const clickY = e.clientY;
        const startX = n ? n.x : 0;
        const startY = n ? n.y : 0;

        const onMove = (ev) => {
          if (!editorState.dragging) return;
          moved = true;
          const dx = (ev.clientX - clickX) / (editorState.zoom || 1);
          const dy = (ev.clientY - clickY) / (editorState.zoom || 1);
          if (n) {
            n.x = Math.round(startX + dx);
            n.y = Math.round(startY + dy);
            el.setAttribute('transform', `translate(${n.x},${n.y})`);
          }
          updateArrowPaths();
        };

        const onUp = () => {
          editorState.dragging = null;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (!moved && el.classList.contains('mcp-cluster')) {
            window.A['toggle-mcp-cluster']();
            return;
          }
          renderEditor();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // Collapse MCP button click
    editor.querySelectorAll('.mcp-collapse-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.A['collapse-mcp']();
      });
    });

    // Handle port connections (click source -> click target)
    editor.querySelectorAll('.handle').forEach((h) => {
      h.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      h.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = h.dataset.node;
        const side = h.dataset.side;
        if (!editorState.connectFromNode) {
          editorState.connectFromNode = id;
          editorState.connectFromSide = side;
          h.setAttribute('r', '8');
          h.setAttribute('fill', 'var(--accent)');
        } else if (editorState.connectFromNode !== id) {
          const fromNode = editorState.nodes.find((x) => x.id === editorState.connectFromNode);
          const toNode = editorState.nodes.find((x) => x.id === id);
          if (fromNode && toNode) {
            const isSub = getNodeSize(fromNode).isSub;
            const tp = isSub ? fromNode.type : side;
            if (!editorState.connections.some((c) => c.from === editorState.connectFromNode && c.to === id)) {
              editorState.connections.push({ from: editorState.connectFromNode, to: id, fp: editorState.connectFromSide, tp });
            }
          }
          editorState.connectFromNode = null;
          editorState.connectFromSide = null;
          renderEditor();
        } else {
          editorState.connectFromNode = null;
          editorState.connectFromSide = null;
          renderEditor();
        }
      });
    });

    // Bind edge clicks for deletion
    editor.querySelectorAll('#team-canvas path[data-edge]').forEach((p) => {
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(p.dataset.edge, 10);
        editorState.connections.splice(i, 1);
        renderEditor();
      });
    });

    // Canvas background pan & deselect
    const svgEl = document.getElementById('team-canvas');
    if (svgEl) {
      svgEl.addEventListener('mousedown', (e) => {
        if (e.target === svgEl || e.target.id === 'canvas-g') {
          let moved = false;
          const startX = e.clientX;
          const startY = e.clientY;
          const origPanX = editorState.panX || 0;
          const origPanY = editorState.panY || 0;
          editorState.panning = true;
          svgEl.classList.add('panning');

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            editorState.panX = origPanX + dx;
            editorState.panY = origPanY + dy;
            const g = document.getElementById('canvas-g');
            if (g) g.setAttribute('transform', `translate(${editorState.panX},${editorState.panY}) scale(${editorState.zoom || 1})`);
          };

          const onUp = () => {
            editorState.panning = false;
            svgEl.classList.remove('panning');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!moved) {
              editorState.selected = null;
              editorState.connectFromNode = null;
              renderEditor();
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }
      });

      svgEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.min(2, Math.max(0.3, (editorState.zoom || 1) * factor));
        const rect = svgEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratio = newZoom / (editorState.zoom || 1);
        editorState.panX = mx - (mx - (editorState.panX || 0)) * ratio;
        editorState.panY = my - (my - (editorState.panY || 0)) * ratio;
        editorState.zoom = newZoom;
        const g = document.getElementById('canvas-g');
        if (g) g.setAttribute('transform', `translate(${editorState.panX},${editorState.panY}) scale(${editorState.zoom})`);
      }, { passive: false });
    }

    // Input handlers for trigger/response/mcp/portSide fields
    const portSideSel = editor.querySelector('#prop-port-side');
    if (portSideSel && selectedNode) {
      portSideSel.onchange = () => { selectedNode.portSide = portSideSel.value; renderEditor(); };
    }
    const trgSel = editor.querySelector('#prop-trigger-type');
    if (trgSel && selectedNode) {
      trgSel.onchange = () => { selectedNode.triggerType = trgSel.value; };
    }
    const rspSel = editor.querySelector('#prop-response-type');
    if (rspSel && selectedNode) {
      rspSel.onchange = () => { selectedNode.responseType = rspSel.value; };
    }
    const mcpPresetSel = editor.querySelector('#prop-mcp-preset');
    if (mcpPresetSel && selectedNode) {
      mcpPresetSel.onchange = () => {
        const val = mcpPresetSel.value;
        const preset = BUILTIN_MCP_SERVERS.find((s) => s.id === val) || BUILTIN_MCP_SERVERS[0];
        selectedNode.serverName = preset.id;
        selectedNode.param = preset.defaultParam;
        selectedNode.tools = preset.tools;
        selectedNode.description = preset.desc;
        selectedNode.systemPrompt = `MCP Server [${preset.name}] enabled. Provides tools: ${preset.tools}. ${preset.desc}`;
        renderEditor();
      };
    }
    const mcpParamInput = editor.querySelector('#prop-mcp-param');
    if (mcpParamInput && selectedNode) {
      mcpParamInput.oninput = () => {
        selectedNode.param = mcpParamInput.value;
      };
    }
    const mcpScope = editor.querySelector('#prop-mcp-scope');
    if (mcpScope && selectedNode) {
      mcpScope.onchange = () => { selectedNode.scope = mcpScope.value; };
    }
  }

  // Action handlers
  window.A = window.A || {};

  window.A['new-team'] = () => { openEditor(null); };

  window.A['edit-team'] = (el) => {
    const id = el ? el.dataset.id : null;
    const S = window.S || {};
    const team = (S.teams || []).find((t) => t.id === id);
    openEditor(team);
  };

  window.A['delete-team'] = async (el) => {
    const id = el ? el.dataset.id : null;
    const S = window.S || {};
    S.teams = (S.teams || []).filter((t) => t.id !== id);
    if (window.vault && window.vault.store) await window.vault.store.set('teams', S.teams);
    if (window.render) window.render();
  };

  window.A['set-active-team'] = async (el) => {
    const id = el ? el.dataset.id : null;
    const S = window.S || {};
    S.activeTeamId = id;
    if (window.vault && window.vault.store) await window.vault.store.set('activeTeamId', id);
    if (window.render) window.render();
  };

  window.A['cancel-team'] = () => { closeEditor(); };

  window.A['save-team'] = async () => {
    const name = (document.getElementById('te-name') || {}).value || 'Team';
    const slug = (document.getElementById('te-slug') || {}).value || name.toLowerCase().replace(/\s+/g, '-');

    const team = {
      id: editorState.team.id,
      name,
      slug,
      enabled: true,
      nodes: editorState.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        model: n.model || '',
        specialty: n.specialty || '',
        systemPrompt: n.systemPrompt || '',
        description: n.description || '',
        triggerType: n.triggerType || '',
        responseType: n.responseType || '',
        syncWithAgent: n.syncWithAgent !== false,
        compact: !!n.compact,
        flipped: !!n.flipped,
        portSide: n.portSide || '',
        permissions: n.permissions || { memory: true, tool: true, mcp: true },
        enabledTools: n.enabledTools || [],
        serverName: n.serverName || '',
        param: n.param !== undefined ? n.param : '',
        tools: n.tools || '',
        scope: n.scope || '',
        x: n.x,
        y: n.y
      })),
      connections: editorState.connections.map((c) => ({ from: c.from, to: c.to, fp: c.fp, tp: c.tp }))
    };

    const S = window.S || {};
    const teams = (S.teams || []).filter((t) => t.id !== team.id);
    teams.push(team);
    S.teams = teams;
    if (window.vault && window.vault.store) await window.vault.store.set('teams', teams);
    closeEditor();
    if (window.render) window.render();
  };

  window.A['test-team'] = () => {
    const conns = editorState.connections || [];
    const nodes = editorState.nodes || [];
    const hasInputToAgent = conns.some((c) => {
      const fromN = nodes.find((n) => n.id === c.from);
      const toN = nodes.find((n) => n.id === c.to);
      return fromN && fromN.type === 'input' && toN && toN.type === 'agent';
    });
    const hasAgentToPlanner = conns.some((c) => {
      const fromN = nodes.find((n) => n.id === c.from);
      const toN = nodes.find((n) => n.id === c.to);
      return fromN && fromN.type === 'agent' && toN && toN.type === 'planner';
    });
    const hasSynthToAgent = conns.some((c) => {
      const fromN = nodes.find((n) => n.id === c.from);
      const toN = nodes.find((n) => n.id === c.to);
      return fromN && fromN.type === 'synthesizer' && toN && toN.type === 'agent';
    });
    const hasAgentToOutput = conns.some((c) => {
      const fromN = nodes.find((n) => n.id === c.from);
      const toN = nodes.find((n) => n.id === c.to);
      return fromN && fromN.type === 'agent' && toN && toN.type === 'output';
    });

    editorState.pulsing = true;
    if (freeNodes.length > 0) {
      editorState.testBanner = {
        type: 'warn',
        text: `⚠ Warning: ${freeNodes.length} free/unconnected node(s) found: ${freeNodes.map(n => n.id).join(', ')}`
      };
    } else if (hasInputToAgent && hasAgentToPlanner && hasSynthToAgent && hasAgentToOutput) {
      editorState.testBanner = {
        type: 'ok',
        text: '⚡ Flow Verified: Input → Agent (with Model, Mem, Tools, MCP) → Boss → Workers → Synthesizer → Agent → Output (100% Connected, 0 Free Nodes)'
      };
    } else {
      editorState.testBanner = {
        type: 'ok',
        text: '⚡ Connection Test Active: 0 Free nodes. Pulse active across all connections.'
      };
    }

    renderEditor();

    setTimeout(() => {
      editorState.pulsing = false;
      editorState.testBanner = null;
      renderEditor();
    }, 3500);
  };

  window.A['add-node'] = (el) => {
    const type = (el && el.dataset && el.dataset.type) || 'worker';
    const nt = NODE_TYPES.find((t) => t.type === type) || NODE_TYPES[0];
    const id = type + '-' + (editorState.nodes.length + 1);
    const S = window.S || {};
    const firstModel = (S.fetchedModels || S.models || [])[0]?.id || 'gpt-4o-mini';

    let defaultPrompt = '';
    let defaultDesc = '';

    if (type === 'input') {
      defaultPrompt = 'Input Trigger: Chat, API Call, or Google Form point.';
      defaultDesc = 'Receives incoming user message or payload and passes to Agent.';
    } else if (type === 'agent') {
      defaultPrompt = 'Central coordinator. Directs tasks and connects tools, memory, and MCP.';
      defaultDesc = 'Directs tasks to planner, receives synthesized output, and delivers to output.';
    } else if (type === 'planner') {
      defaultPrompt = 'You are the boss. Split the user request into parts tagged by specialty and route them.';
      defaultDesc = 'Breaks complex tasks into specialized parts for workers.';
    } else if (type === 'worker') {
      defaultPrompt = 'Specialist Worker. Complete assigned part thoroughly.';
      defaultDesc = 'Executes specialty tasks with shared memory context.';
    } else if (type === 'synthesizer') {
      defaultPrompt = 'You are the synthesizer. Merge all worker outputs into one coherent answer and return to Agent.';
      defaultDesc = 'Combines outputs and feeds back into Agent coordinator.';
    } else if (type === 'output') {
      defaultPrompt = 'Output Response Node. Formats and delivers finalized answer back to client.';
      defaultDesc = 'Returns completed response to chat stream or API caller.';
    } else if (type === 'memory') {
      defaultPrompt = 'Shared Memory Context. Automatically synchronizes context between workers so big tasks retain full state.';
      defaultDesc = 'Persistent task context bus synced with Agent coordinator.';
    } else if (type === 'tool') {
      defaultPrompt = 'Tool Calling active. You have access to built-in tools: grep (search workspace), powershell (run shell commands), file_view (read files), file_edit (surgical edits).';
      defaultDesc = 'Built-in workspace tool calls with Windows PowerShell validation.';
    } else if (type === 'mcp') {
      const defaultMcp = BUILTIN_MCP_SERVERS[0];
      defaultPrompt = `MCP Server [${defaultMcp.name}] enabled. Provides tools: ${defaultMcp.tools}. ${defaultMcp.desc}`;
      defaultDesc = defaultMcp.desc;
    }

    const count = editorState.nodes.length;
    editorState.nodes.push({
      id,
      type,
      model: nt.isSub && type !== 'model' ? '' : firstModel,
      specialty: type === 'worker' ? 'general' : '',
      systemPrompt: defaultPrompt,
      description: defaultDesc,
      syncWithAgent: true,
      compact: false,
      flipped: false,
      permissions: { memory: true, tool: true, mcp: true },
      enabledTools: ['grep', 'powershell', 'file_view', 'file_edit', 'web_fetch'],
      serverName: type === 'mcp' ? 'filesystem' : '',
      param: type === 'mcp' ? '.' : '',
      tools: type === 'mcp' ? BUILTIN_MCP_SERVERS[0].tools : '',
      scope: 'all-models',
      triggerType: 'chat',
      responseType: 'chat',
      x: 120 + (count % 5) * 50,
      y: 120 + (count % 4) * 40
    });
    editorState.selected = id;
    renderEditor();
  };

  window.A['delete-node'] = (el) => {
    const id = (el && el.dataset && el.dataset.id) || editorState.selected;
    if (!id) return;
    editorState.nodes = editorState.nodes.filter((n) => n.id !== id);
    editorState.connections = editorState.connections.filter((c) => c.from !== id && c.to !== id);
    editorState.selected = null;
    renderEditor();
  };

  window.A['flip-node'] = (el) => {
    const id = (el && el.dataset && el.dataset.id) || editorState.selected;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;
    if (getNodeSize(node).isSub) {
      const order = ['top', 'right', 'bottom', 'left'];
      const cur = getSubPortSide(node);
      node.portSide = order[(order.indexOf(cur) + 1) % order.length];
    } else {
      node.flipped = !node.flipped;
    }
    renderEditor();
  };

  window.A['toggle-connect'] = () => {};

  window.A['zoom-in'] = () => {
    editorState.zoom = Math.min(2, (editorState.zoom || 1) + 0.15);
    renderEditor();
  };

  window.A['zoom-out'] = () => {
    editorState.zoom = Math.max(0.3, (editorState.zoom || 1) - 0.15);
    renderEditor();
  };

  window.A['fit-view'] = () => {
    const fit = computeFitTransform();
    editorState.zoom = fit.zoom;
    editorState.panX = fit.panX;
    editorState.panY = fit.panY;
    renderEditor();
  };

  window.A['prop-type'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) { node.type = el.value; renderEditor(); }
  };
  window.A['prop-model'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) { node.model = el.value; renderEditor(); }
  };
  window.A['prop-specialty'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) node.specialty = el.value;
  };
  window.A['prop-prompt'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) node.systemPrompt = el.value;
  };
  window.A['prop-desc'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) node.description = el.value;
  };
  window.A['toggle-tool'] = (el) => {
    const id = el.dataset.id;
    const toolId = el.dataset.tool;
    const node = editorState.nodes.find((n) => n.id === id);
    if (node) {
      if (!node.enabledTools) node.enabledTools = [];
      if (el.checked) {
        if (!node.enabledTools.includes(toolId)) node.enabledTools.push(toolId);
      } else {
        node.enabledTools = node.enabledTools.filter((t) => t !== toolId);
      }
    }
  };
  window.A['sync-memory'] = (el) => {
    const id = el.dataset.id;
    const node = editorState.nodes.find((n) => n.id === id);
    if (node) node.syncWithAgent = el.checked;
  };
  window.A['toggle-compact'] = (el) => {
    const id = el.dataset.id;
    const node = editorState.nodes.find((n) => n.id === id);
    if (node) {
      node.compact = el.checked;
      renderEditor();
    }
  };
  window.A['toggle-perm'] = (el) => {
    const id = el.dataset.id;
    const cap = el.dataset.cap;
    const node = editorState.nodes.find((n) => n.id === id);
    if (node) {
      if (!node.permissions) node.permissions = { memory: true, tool: true, mcp: true };
      node.permissions[cap] = el.checked;
      renderEditor();
    }
  };
  window.A['toggle-mcp-server'] = (el) => {
    const id = el.dataset.id;
    const serverId = el.dataset.server;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;
    if (!Array.isArray(node.enabledServers)) {
      node.enabledServers = node.serverName ? [node.serverName] : ['filesystem'];
    }
    if (el.checked) {
      if (!node.enabledServers.includes(serverId)) {
        node.enabledServers.push(serverId);
      }
    } else {
      node.enabledServers = node.enabledServers.filter((s) => s !== serverId);
    }
    const activePresets = BUILTIN_MCP_SERVERS.filter((s) => node.enabledServers.includes(s.id));
    node.systemPrompt = `Active MCP Servers: ${activePresets.map((p) => p.name).join(', ')}. Tools available: ${activePresets.map((p) => p.tools).join(', ')}.`;
    renderEditor();
  };
  window.A['update-mcp-param'] = (el) => {
    const id = el.dataset.id;
    const serverId = el.dataset.server;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;
    if (!node.serverParams) node.serverParams = {};
    node.serverParams[serverId] = el.value;
    if (serverId === node.serverName) node.param = el.value;
  };

  window.A['save-node'] = (el) => {
    const id = el ? el.dataset.id : editorState.selected;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;

    const drawer = document.querySelector('.team-props');
    if (drawer) {
      const nameInput = drawer.querySelector('#prop-node-name');
      if (nameInput) node.name = nameInput.value.trim();

      const typeSelect = drawer.querySelector('[data-a="prop-type"]');
      if (typeSelect) node.type = typeSelect.value;

      const modelSelect = drawer.querySelector('[data-a="prop-model"]');
      if (modelSelect) node.model = modelSelect.value;

      const specialtyInput = drawer.querySelector('[data-a="prop-specialty"]');
      if (specialtyInput) node.specialty = specialtyInput.value.trim();

      const promptTextarea = drawer.querySelector('[data-a="prop-prompt"]');
      if (promptTextarea) node.systemPrompt = promptTextarea.value;

      const descTextarea = drawer.querySelector('[data-a="prop-desc"]');
      if (descTextarea) node.description = descTextarea.value;

      const portSideSel = drawer.querySelector('#prop-port-side');
      if (portSideSel) node.portSide = portSideSel.value;

      const trgSel = drawer.querySelector('#prop-trigger-type');
      if (trgSel) node.triggerType = trgSel.value;

      const rspSel = drawer.querySelector('#prop-response-type');
      if (rspSel) node.responseType = rspSel.value;

      const mcpScopeSel = drawer.querySelector('#prop-mcp-scope');
      if (mcpScopeSel) node.scope = mcpScopeSel.value;

      const mcpPresetSel = drawer.querySelector('#prop-mcp-preset');
      if (mcpPresetSel) {
        node.serverName = mcpPresetSel.value;
        const preset = BUILTIN_MCP_SERVERS.find((s) => s.id === mcpPresetSel.value);
        if (preset) node.tools = preset.tools;
      }

      const mcpParamInput = drawer.querySelector('#prop-mcp-param');
      if (mcpParamInput) {
        node.param = mcpParamInput.value;
      }
    }

    if (el) {
      el.textContent = 'Saved ✓';
      setTimeout(() => {
        renderEditor();
      }, 500);
    } else {
      renderEditor();
    }
  };

  window.A['prop-name'] = (el) => {
    const node = editorState.nodes.find((n) => n.id === el.dataset.id);
    if (node) node.name = el.value;
  };

  window.A['toggle-mcp-cluster'] = () => {
    editorState.mcpExpanded = !editorState.mcpExpanded;
    if (editorState.mcpExpanded) {
      const mcpNodes = editorState.nodes.filter((n) => n.type === 'mcp');
      const startX = 350;
      const baseY = 255;
      mcpNodes.forEach((n, idx) => {
        n.x = startX + idx * 56;
        n.y = baseY;
      });
    }
    renderEditor();
  };

  window.A['collapse-mcp'] = () => {
    editorState.mcpExpanded = false;
    renderEditor();
  };

  window.A['expand-mcp'] = () => {
    editorState.mcpExpanded = true;
    const mcpNodes = editorState.nodes.filter((n) => n.type === 'mcp');
    const startX = 350;
    const baseY = 255;
    mcpNodes.forEach((n, idx) => {
      n.x = startX + idx * 56;
      n.y = baseY;
    });
    renderEditor();
  };

  // Property inputs listener
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.a) return;
    const id = t.dataset.id;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;
    if (t.dataset.a === 'prop-name') { node.name = t.value; }
    if (t.dataset.a === 'prop-type') { node.type = t.value; renderEditor(); }
    if (t.dataset.a === 'prop-model') { node.model = t.value; renderEditor(); }
    if (t.dataset.a === 'prop-specialty') { node.specialty = t.value; }
    if (t.dataset.a === 'prop-prompt') { node.systemPrompt = t.value; }
    if (t.dataset.a === 'prop-desc') { node.description = t.value; }
    if (t.dataset.a === 'update-mcp-param') {
      const serverId = t.dataset.server;
      if (!node.serverParams) node.serverParams = {};
      node.serverParams[serverId] = t.value;
      if (serverId === node.serverName) node.param = t.value;
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.a) return;
    const id = t.dataset.id;
    const node = editorState.nodes.find((n) => n.id === id);
    if (!node) return;
    if (t.dataset.a === 'prop-name') { node.name = t.value; }
    if (t.dataset.a === 'update-mcp-param') {
      const serverId = t.dataset.server;
      if (!node.serverParams) node.serverParams = {};
      node.serverParams[serverId] = t.value;
      if (serverId === node.serverName) node.param = t.value;
    }
  });

  const TeamsView = {
    render() {
      const S = window.S || {};
      const teams = S.teams || [];
      return `
        <div class="view teams-view">
          <div class="view-head">
            <div>
              <h2>Teams</h2>
              <p class="mute">Build a multi-model team. Each team is exposed as <code>mine/agent/&lt;slug&gt;</code> and behaves like one model to any client.</p>
            </div>
            <div class="row">
              <button class="btn primary" data-a="new-team">+ New team</button>
            </div>
          </div>

          <div class="teams-list">
            ${teams.length ? teams.map((t) => `
              <div class="card team-card" data-team="${escapeAttr(t.id)}">
                <div class="team-card-head">
                  <div>
                    <div class="team-name">${escapeHtml(t.name || t.id)}</div>
                    <div class="mute mono" style="font-size:11px;margin-top:4px">mine/agent/${escapeHtml(t.slug || t.id)} · ${(t.nodes || []).length} nodes</div>
                  </div>
                  <div class="row">
                    ${(S.activeTeamId === t.id) ? '<span class="chip ok">Active</span>' : '<button class="btn sm" data-a="set-active-team" data-id="' + escapeAttr(t.id) + '">Set active</button>'}
                    <button class="btn sm" data-a="edit-team" data-id="${escapeAttr(t.id)}">Edit</button>
                    <button class="btn sm danger" data-a="delete-team" data-id="${escapeAttr(t.id)}">Delete</button>
                  </div>
                </div>
                <div class="team-nodes-preview">
                  ${(t.nodes || []).map((n) => `<span class="node-chip ${escapeAttr(n.type)}">${escapeHtml(n.type)}${n.model ? ': ' + escapeHtml(n.model.split('/').pop()) : ''}</span>`).join('')}
                </div>
              </div>
            `).join('') : '<div class="empty">No teams yet. Create one to orchestrate multiple models.</div>'}
          </div>

          <div id="team-editor" class="team-editor hidden"></div>

          <div class="card" style="margin-top:16px">
            <h3>Use a team in your coding CLI</h3>
            <p class="mute">Point your client (Cline, Continue, Aider, etc.) at the Mine gateway and set the model to one of:</p>
            <ul style="margin:8px 0 0 18px;line-height:1.7">
              <li><code>mine/auto</code> — follows your Model Queue (first favorite / discovered model).</li>
              <li><code>mine/agent/&lt;slug&gt;</code> — runs the whole team graph (Input → Agent → Boss → Workers → Synthesizer → Agent → Output) and returns one answer.</li>
            </ul>
            <p class="mute" style="margin-top:8px">Gateway base URL: <code>${(window.gwUrl ? window.gwUrl() : '/v1')}</code>. API key: your gateway key from Settings.</p>
            <p class="mute" style="margin-top:8px">Inline commands: <code>/status</code>, <code>/boss</code>, <code>/worker1</code>, <code>/synth</code>, <code>/team &lt;msg&gt;</code>. Bare <code>/</code> lists available commands.</p>
          </div>
        </div>
      `;
    }
  };

  window.V.teams = function () {
    const S = window.S || {};
    if (!S.teams) S.teams = [];
    if (S.activeTeamId === undefined) S.activeTeamId = null;
    return TeamsView.render();
  };

  window.openTeamEditor = openEditor;
})();
