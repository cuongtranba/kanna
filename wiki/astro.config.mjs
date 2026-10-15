import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { sidebar } from './src/sidebar.mjs'

export default defineConfig({
  site: 'https://kanna-wiki.lowbit.link',
  base: '/',
  integrations: [
    starlight({
      title: 'Kanna',
      description: 'A web UI for the Claude Code and Codex agents, built for long sessions across many projects',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      // The mark is assets/logo.svg at the repo root, the vector of README's
      // assets/icon.png; brand-assets.test.ts keeps every copy identical.
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' } },
      ],
      customCss: ['./src/styles/kanna-theme.css'],
      // social format for Starlight >=0.33: array of link items
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/cuongtranba/kanna',
        },
      ],
      sidebar,
    }),
  ],
})
