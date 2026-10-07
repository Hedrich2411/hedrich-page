// @ts-check
import node from '@astrojs/node';
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://hedrich.dev',
  devToolbar: { enabled: false },
  // Las páginas siguen siendo estáticas; solo /api/contacto corre en el servidor.
  adapter: node({ mode: 'standalone' }),
  vite: { plugins: [tailwindcss()] },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
      // the fence's meta (```py main.py) becomes the label on the block's header bar
      transformers: [
        {
          pre(node) {
            const meta = this.options.meta?.__raw;
            if (meta) node.properties['data-title'] = meta;
          },
        },
      ],
    },
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Urbanist',
      cssVariable: '--font-urbanist',
      weights: [400, 500, 600, 800],
      subsets: ['latin'],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains',
      weights: [400, 500],
      subsets: ['latin'],
    },
  ],
});
