import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { SearchComponent } from './search/search.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, SearchComponent],
  template: `
    <div class="shell">

      <!-- Accent bar at top -->
      <div class="accent-bar"></div>

      <header class="header">
        <div class="header-inner">

          <!-- Brand -->
          <div class="brand">
            <div class="brand-icon">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 9.5L12 3L21 9.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
                      stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                <path d="M9 21V13h6v8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="brand-text">
              <span class="brand-name">Nadlan Scout</span>
              <span class="brand-tag">Israel Real Estate Intelligence</span>
            </div>
          </div>

          <!-- Right controls -->
          <div class="header-right">
            <span class="live-badge">
              <span class="live-dot"></span>
              Live
            </span>
            <button class="theme-btn" (click)="toggleTheme()" [title]="light ? 'Switch to dark mode' : 'Switch to light mode'">
              @if (light) {
                <!-- Moon icon -->
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
                        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              } @else {
                <!-- Sun icon -->
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              }
            </button>
          </div>

        </div>
      </header>

      <main class="main">
        <app-search />
      </main>

    </div>
  `,
  styles: [`
    .shell {
      min-height: 100vh;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      transition: background 0.2s;
    }

    /* Top gradient accent stripe */
    .accent-bar {
      height: 3px;
      background: var(--gradient-accent);
      flex-shrink: 0;
    }

    /* Header */
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: var(--shadow-sm);
      transition: background 0.2s, border-color 0.2s;
    }

    .header-inner {
      max-width: 1440px;
      margin: 0 auto;
      padding: 0 28px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Brand */
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 40px;
      height: 40px;
      background: var(--gradient-accent);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(79,142,247,0.35);
      flex-shrink: 0;
      svg { width: 20px; height: 20px; color: #fff; }
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .brand-name {
      font-size: 17px;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.4px;
      line-height: 1;
    }

    .brand-tag {
      font-size: 10.5px;
      color: var(--muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 500;
    }

    /* Right controls */
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: var(--green-dim);
      border: 1px solid rgba(16,185,129,0.25);
      border-radius: 99px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--green);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      animation: pulse-live 2s infinite;
    }

    /* Theme toggle */
    .theme-btn {
      width: 36px;
      height: 36px;
      border-radius: 99px;
      border: 1px solid var(--border);
      background: var(--elevated);
      color: var(--sub);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      svg { width: 16px; height: 16px; }
      &:hover {
        background: var(--blue-dim);
        border-color: var(--blue);
        color: var(--blue);
      }
    }

    /* Main content */
    .main {
      flex: 1;
      max-width: 1440px;
      width: 100%;
      margin: 0 auto;
      padding: 0 28px 48px;
    }

    @keyframes pulse-live {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
      50%       { opacity: 0.8; box-shadow: 0 0 0 5px rgba(16,185,129,0); }
    }
  `],
})
export class AppComponent implements OnInit {
  light = false

  ngOnInit() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null
    const preferLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
    this.light = saved ? saved === 'light' : preferLight
    this.applyTheme()
  }

  toggleTheme() {
    this.light = !this.light
    localStorage.setItem('theme', this.light ? 'light' : 'dark')
    this.applyTheme()
  }

  private applyTheme() {
    document.documentElement.setAttribute('data-theme', this.light ? 'light' : 'dark')
  }
}
