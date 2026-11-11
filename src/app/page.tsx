export default function MineRoutePage() {
  return (
    <div dangerouslySetInnerHTML={{ __html: `  <div class="app-layout">
    <!-- Sidebar Navigation -->
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-logo-wrap">
          <svg class="brand-logo-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="url(#Mine-grad-1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="url(#Mine-grad-1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="url(#Mine-grad-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <defs>
              <linearGradient id="Mine-grad-1" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stop-color="#a855f7"/>
                <stop offset="1" stop-color="#6366f1"/>
              </linearGradient>
              <linearGradient id="Mine-grad-2" x1="2" y1="12" x2="22" y2="17" gradientUnits="userSpaceOnUse">
                <stop stop-color="#c084fc"/>
                <stop offset="1" stop-color="#818cf8"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div class="brand-text">
          <div class="brand-title">MineRoute</div>
          <div class="brand-subtitle">Unified AI Proxy</div>
        </div>
      </div>

      <nav class="nav-menu" aria-label="Main Sidebar Navigation">
        <div class="nav-section-label">ROUTING &amp; TOPOLOGY</div>
        <button class="nav-item active" data-p="overview" title="Dashboard: Overview + Provider Topology">
          <span class="nav-icon">◈</span>
          <span class="nav-label">Dashboard (Overview + Provider Topology)</span>
        </button>
        <button class="nav-item nav-item-team" data-p="teams" title="Team: Interactive Flow Canvas">
          <span class="nav-icon">⚡</span>
          <span class="nav-label">Team (Interactive Flow Canvas)</span>
          <span class="badge badge-purple" id="badge-teams">1</span>
        </button>
        <button class="nav-item" data-p="providers" title="Providers: AI Endpoints">
          <span class="nav-icon">◫</span>
          <span class="nav-label">Providers</span>
          <span class="badge" id="badge-providers">8</span>
        </button>
        <button class="nav-item" data-p="models" title="Models: Discovered Catalog">
          <span class="nav-icon">◈</span>
          <span class="nav-label">Models</span>
          <span class="badge" id="badge-models">15</span>
        </button>
        <button class="nav-item" data-p="combos" title="Combos: Multi-Model Strategies">
          <span class="nav-icon">≋</span>
          <span class="nav-label">Combos</span>
        </button>
        <button class="nav-item" data-p="mcp" title="Model Context Protocol (MCP) Tools">
          <span class="nav-icon">🛠</span>
          <span class="nav-label">MCP Tools</span>
        </button>
        <button class="nav-item" data-p="skills" title="Builtin Skills Framework">
          <span class="nav-icon">🧩</span>
          <span class="nav-label">Skills</span>
        </button>

        <div class="nav-section-label" style="margin-top: 14px;">GATEWAY MANAGEMENT</div>
        <button class="nav-item" data-p="keys" title="API Keys Vault">
          <span class="nav-icon">⚿</span>
          <span class="nav-label">API Keys</span>
          <span class="badge" id="badge-keys">0</span>
        </button>
        <button class="nav-item" data-p="playground" title="Interactive Live Playground">
          <span class="nav-icon">▶</span>
          <span class="nav-label">Playground</span>
        </button>
        <button class="nav-item" data-p="logs" title="Request Audit Logs">
          <span class="nav-icon">📋</span>
          <span class="nav-label">Logs</span>
          <span class="badge" id="badge-logs">0</span>
        </button>
        <button class="nav-item" data-p="settings" title="Gateway Settings">
          <span class="nav-icon">⚙</span>
          <span class="nav-label">Settings</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="status-box">
          <div class="row align-center gap-xs">
            <span class="status-dot green"></span>
            <span class="status-text">Gateway Online</span>
          </div>
          <div class="status-port mono">Port: <span id="lbl-port">20128</span> · 100% Portable</div>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="main-wrapper">
      <!-- Glassmorphic Topbar -->
      <header class="topbar">
        <div class="topbar-brand-left">
          <div class="topbar-logo">
            <svg class="brand-logo-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="url(#topbar-grad-1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="url(#topbar-grad-1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="url(#topbar-grad-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <defs>
                <linearGradient id="topbar-grad-1" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#a855f7"/>
                  <stop offset="1" stop-color="#6366f1"/>
                </linearGradient>
                <linearGradient id="topbar-grad-2" x1="2" y1="12" x2="22" y2="17" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#c084fc"/>
                  <stop offset="1" stop-color="#818cf8"/>
                </linearGradient>
              </defs>
            </svg>
            <span class="topbar-brand-title">MineRoute</span>
          </div>
          <div class="topbar-divider"></div>
          <div class="topbar-title-wrap">
            <h1 id="page-title">Dashboard</h1>
            <p id="page-sub" class="mute">Overview + Provider Topology</p>
          </div>
        </div>

        <div class="topbar-right">
          <div class="topbar-status-indicator" title="Gateway Server Status">
            <span class="status-dot green pulse"></span>
            <span class="status-label">Online</span>
          </div>

          <div class="topbar-port-badge mono" title="Listening on port 20128">
            <span class="port-icon">⚡</span>
            <span class="port-text">:20128</span>
          </div>

          <div class="quick-model-wrap">
            <label for="quick-model-select" class="quick-model-label">Model:</label>
            <select id="quick-model-select" class="quick-model-dropdown mono" onchange="window.handleQuickModelChange(this.value)">
              <option value="MineRoute/team/Mine">⚡ Team: MineRoute/team/Mine</option>
              <option value="auto">auto (Auto-Combo)</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
              <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
            </select>
          </div>

          <button class="btn primary sm topbar-test-btn" onclick="window.navigate('playground')">Playground &rarr;</button>
        </div>
      </header>

      <!-- Dynamic View Container -->
      <main id="view"></main>
    </div>
  </div>
  <div id="mine-toast" class="mine-toast"></div>
` }} />
  );
}
