import stencil from '@stencil/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'loader/**', 'www/**', 'src/components.d.ts', '*.config.*'],
  },
  {
    ...stencil.configs.flat.recommended,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...stencil.configs.flat.recommended.languageOptions,
      parser: tsParser,
      parserOptions: {
        ...stencil.configs.flat.recommended.languageOptions.parserOptions,
        project: './tsconfig.json',
      },
    },
  },
];
