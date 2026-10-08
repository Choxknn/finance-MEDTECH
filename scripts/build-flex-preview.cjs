// The admin preview and LINE payload use the same template definitions.
const fs=require('fs'),esbuild=require('esbuild');
const result=esbuild.transformSync(fs.readFileSync('supabase/functions/_shared/line-flex.ts','utf8'),{loader:'ts',format:'iife',globalName:'FinanceFlex',minify:true});
fs.writeFileSync('web/flex-templates.js',result.code);
