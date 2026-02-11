import { Config } from '@stencil/core';
import { sass } from '@stencil/sass';

export const config: Config = {
  namespace: 'web-to-print',
  plugins: [
    sass({
      includePaths: ['src/styles'],
    }),
  ],
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
    },
    {
      type: 'dist-custom-elements',
      customElementsExportBehavior: 'auto-define-custom-elements',
      externalRuntime: false,
    },
    {
      type: 'docs-readme',
    },
    {
      type: 'www',
      serviceWorker: null,
      copy: [
        { src: 'examples/demo-article', dest: 'demo-article' },
        { src: 'tool-print-area.html', dest: 'tool-print-area.html' },
      ],
    },
  ],
  testing: {
    browserHeadless: 'shell',
  },
};
