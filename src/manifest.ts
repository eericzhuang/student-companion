import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  // "for Workday" (nominative use) rather than leading with the trademark —
  // Chrome Web Store impersonation policy rejects names that imply affiliation.
  name: 'Student Companion for Workday',
  version: '0.1.0',
  description:
    'Live schedule calendar, RateMyProfessors ratings, and multi-degree planning for Workday Student.',
  // world:'MAIN' content scripts require Chrome 111+.
  minimum_chrome_version: '111',
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://*.myworkday.com/*'],
      js: ['src/page/interceptor.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://*.myworkday.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      world: 'ISOLATED',
    },
  ],
  options_page: 'src/options/index.html',
  action: {
    default_title: 'Student Companion for Workday',
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://*.myworkday.com/*',
    'https://www.ratemyprofessors.com/*',
    'https://api.anthropic.com/*',
  ],
  optional_host_permissions: ['https://*/*'],
  web_accessible_resources: [
    {
      resources: ['src/planner/index.html'],
      matches: ['https://*.myworkday.com/*'],
    },
  ],
});
