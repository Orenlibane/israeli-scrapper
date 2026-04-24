import { Component } from '@angular/core'
import { SearchComponent } from './search/search.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SearchComponent],
  template: `
    <div class="app">
      <header>
        <h1>🏠 Israeli Nadlan Scraper</h1>
        <p>Real-time listing search &amp; market comparison</p>
      </header>
      <main>
        <app-search />
      </main>
    </div>
  `,
  styles: [`
    .app { min-height: 100vh; background: #0f1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    header { padding: 32px 24px 0; text-align: center; }
    header h1 { font-size: 28px; font-weight: 700; color: #fff; margin: 0 0 6px; }
    header p { color: #64748b; font-size: 14px; margin: 0; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  `],
})
export class AppComponent {}
