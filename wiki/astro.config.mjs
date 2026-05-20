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
      // social format for Starlight 0.30.x: object map of icon -> URL
      social: {
        github: 'https://github.com/cuongtranba/kanna',
      },
      // TODO: re-enable full sidebar in Task 4 (missing pages cause build failure)
      sidebar: [
        { label: 'Home', link: '/' },
      ],
    }),
  ],
})
