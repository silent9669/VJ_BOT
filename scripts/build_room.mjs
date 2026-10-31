import { build } from 'esbuild';
await build({entryPoints:['src/client/room.js'],bundle:true,minify:true,format:'esm',outfile:'static/room.js',target:'es2022'});
