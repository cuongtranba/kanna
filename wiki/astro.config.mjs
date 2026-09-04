import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://kanna-wiki.lowbit.link',
  base: '/',
  integrations: [
    starlight({
      title: 'Kanna',
      description: 'A beautiful web UI for the Claude Code & Codex CLIs',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      customCss: ['./src/styles/kanna-theme.css'],
      // social format for Starlight >=0.33: array of link items
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/cuongtranba/kanna',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Install', slug: 'getting-started/install' },
            { label: 'First Chat', slug: 'getting-started/first-chat' },
            { label: 'OAuth Pool Setup', slug: 'getting-started/oauth-pool-setup' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'Providers & Models', slug: 'features/providers-models' },
            { label: 'Chat & Transcript', slug: 'features/chat-transcript' },
            { label: 'Projects & Sessions', slug: 'features/projects-sessions' },
            { label: 'Boards', slug: 'features/boards' },
            { label: 'Multi-repo Stacks', slug: 'features/multi-repo-stacks' },
            { label: 'Slash Commands', slug: 'features/slash-commands' },
            { label: 'Cron Jobs', slug: 'features/cron-jobs' },
            { label: 'Loops', slug: 'features/loops' },
            { label: 'Package Auto-Update', slug: 'features/package-auto-update' },
            { label: 'Advanced', slug: 'features/advanced' },
            { label: 'Security', slug: 'features/security-sandboxing' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'User Guide', items: [{ autogenerate: { directory: 'guides/user' } }] },
            {
              label: 'Contributing',
              items: [{ autogenerate: { directory: 'guides/contributing' } }],
            },
            { label: 'Ops & Self-Host', items: [{ autogenerate: { directory: 'guides/ops' } }] },
          ],
        },
        {
          label: 'Sharing',
          items: [
            { label: 'Read-only session share', slug: 'sharing/session-share' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Env Vars', slug: 'reference/env-vars' },
            { label: 'Keybindings', slug: 'reference/keybindings' },
            { label: 'Performance Alerts', slug: 'reference/performance-alerts' },
          ],
        },
        {
          label: 'Changelog',
          slug: 'changelog',
        },
      ],
    }),
  ],
})
