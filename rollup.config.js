import replace from 'rollup-plugin-replace';

export default {
    input: 'build/src/ethereum-block.js',
    output: {
        format: 'cjs'
    },
    plugins: [
        replace({
            'process.browser': process.env.BROWSER === "true"
        })
    ]
};