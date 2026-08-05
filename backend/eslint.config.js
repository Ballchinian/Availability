import js from '@eslint/js';
import globals from 'globals';

/*
    Correctness only, no formatting rules. The style here is hand kept and a
    formatter would rewrite most of the tree to say the same thing, so this is
    the half that earns its place: unused bindings, typos in globals, mistakes
    that read fine and behave badly.
*/

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node
        },
        rules: {
            //A leading underscore is the way to say a binding is deliberately unused
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'error'
            /*
                no-await-in-loop is deliberately absent: the DM sender, the cleanup
                sweep and the mongo retry all serialise on purpose, so it would sit
                at a permanent sixteen warnings and stop anyone reading the output.
            */
        }
    }
];
