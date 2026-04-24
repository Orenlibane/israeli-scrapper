import { Component } from '@angular/core'
import { SearchComponent } from './search/search.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SearchComponent],
  template: `
    <div class="shell">
      <header class="header">
        <div class="header-inner">
          <div class="brand">
            <div class="brand-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 9.5L12 3L21 9.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
                      stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                <path d="M9 21V13h6v8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="brand-text">
              <span class="brand-name">Nadlan Scout</span>
              <span class="brand-tag">Israel real estate intelligence</span>
            </div>
          </div>
          <div class="header-right">
            <span class="live-badge">
              <span class="live-dot"></span>
              Live
            </span>
          </div>
        </div>
      </header>
      <main class="main">
        <app-search />
      </main>
    </div>
  `,
  styles: [`
    .shell { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }

    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-inner {
      max-width: 1440px;
      margin: 0 auto;
      padding: 0 28px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-icon-wrap {
      width: 36px;
      height: 36px;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.25);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      svg { width: 18px; height: 18px; color: var(--blue); }
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .brand-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.3px;
      line-height: 1;
    }

    .brand-tag {
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 0.01em;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(16,185,129,0.08);
      border: 1px solid rgba(16,185,129,0.2);
      border-radius: 99px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--green);
      letter-spacing: 0.02em;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      animation: pulse-live 2s infinite;
    }

    .main {
      flex: 1;
      max-width: 1440px;
      width: 100%;
      margin: 0 auto;
      padding: 0 28px 40px;
    }

    @keyframes pulse-live {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
      50%       { opacity: 0.7; box-shadow: 0 0 0 4px rgba(16,185,129,0); }
    }
  `],
})
export class AppComponent {}
