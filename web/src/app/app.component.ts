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
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9.5L12 3L21 9.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M9 21V13h6v8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
            <div>
              <div class="brand-title">Nadlan Scout</div>
              <div class="brand-sub">Live Yad2 market intelligence</div>
            </div>
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
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 24px;
      height: 58px;
      display: flex;
      align-items: center;
    }

    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { width: 26px; height: 26px; color: var(--blue); flex-shrink: 0; }
    .brand-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
    .brand-sub { font-size: 11.5px; color: var(--muted); margin-top: 1px; }

    .main { flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; padding: 24px; }
  `],
})
export class AppComponent {}
