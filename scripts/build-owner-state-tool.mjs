import {build} from 'esbuild';
await build({entryPoints:['ops/frontpage-owner-state.mjs'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'.owner-tool/frontpage-owner-state.mjs',packages:'external'});
