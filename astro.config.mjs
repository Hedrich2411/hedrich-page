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
      name: 'Figtree',
      cssVariable: '--font-figtree',
      weights: [400, 500, 800],
      subsets: ['latin'],
    },
  ],
});
