import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/*
    Correctness only, no formatting rules, same reasoning as the backend config.
    svelte-check already covers types inside .svelte files, so what this adds is
    the markup half: unused bindings, a11y slips, reactive state that is written
    but never read.
*/

export default ts.config(
    js.configs.recommended,
    ...ts.configs.recommended,
    ...svelte.configs.recommended,
    {
        languageOptions: {
            globals: globals.browser
        },
        rules: {
            //A leading underscore is the way to say a binding is deliberately unused
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            /*
                The api payloads are any on purpose until they get real interfaces,
                which is its own job. Flagging every one of them now would leave the
                linter permanently red and worth ignoring.
            */
            '@typescript-eslint/no-explicit-any': 'off',
            /*
                Every Date and Set here is a working value inside a calculation, never
                state anything reads back, so the reactive versions would buy nothing.
            */
            'svelte/prefer-svelte-reactivity': 'off'
        }
    },
    {
        files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
        languageOptions: {
            parserOptions: {
                parser: ts.parser
            }
        },
        rules: {
            //Runes props come off $props() as let, which is not a reassignment
            'prefer-const': 'off'
        }
    },
    {
        ignores: ['dist/']
    }
);
