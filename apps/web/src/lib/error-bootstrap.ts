// CAMP-92 — the inline script that listens from the first byte.
//
// 🔴 Its own module, and NOT the 'use client' component, because the
// root layout is a server component: importing a plain constant across
// that boundary is a rule worth not relying on. This file has no React
// and no client directive, so both sides may read it.

/**
 * The inline bootstrap, as source.
 *
 * 🔴 Deliberately tiny and deliberately dumb. It captures and queues;
 * it decides nothing and it sends nothing. Every rule about what may
 * leave the page lives in lib/error-report.ts and runs on the queued
 * data later — putting any of it here would mean maintaining the
 * privacy rules in two languages, and the inline copy is the one nobody
 * would remember to update.
 *
 * ES5 on purpose: this is the code that has to run on the browser too
 * old for the rest of the bundle, which is one of the cases it exists
 * to report.
 */
export const BOOTSTRAP = `(function(){
var q=window.__campErrors=window.__campErrors||[];
var t0=Date.now();
function push(e){q.push(e);if(q.length>64){q.shift();}if(window.__campDrain){try{window.__campDrain();}catch(x){}}}
window.addEventListener('error',function(ev){push({kind:'error',message:ev.message,stack:ev.error&&ev.error.stack,source:ev.filename,line:ev.lineno,href:location.href,sinceLoadMs:Date.now()-t0});},true);
window.addEventListener('unhandledrejection',function(ev){var r=ev.reason;push({kind:'promise',message:r&&r.message?r.message:String(r),stack:r&&r.stack,href:location.href,sinceLoadMs:Date.now()-t0});});
})();`;
