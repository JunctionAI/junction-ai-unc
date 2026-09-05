// Original deterministic 30-second electronic cue. No samples or licensed music.
// Generates an asset, never reads credentials or changes application data.
import {writeFileSync} from 'node:fs';
const rate=48000,seconds=30,frames=rate*seconds,out=Buffer.alloc(44+frames*4);
out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(2,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*4,28);out.writeUInt16LE(4,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(frames*4,40);
let seed=91376,peak=0;
const roots=[55,65.4064,43.6535,48.9994],notes=[220,261.6256,329.6276,391.9954,440,329.6276,261.6256,293.6648];
for(let i=0;i<frames;i++){
  const t=i/rate,beat=t%.5,half=t%.25,root=roots[Math.floor(t/4)%4];
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967295*2-1;
  const kick=Math.sin(2*Math.PI*(45*beat+9*(1-Math.exp(-beat*22))))*Math.exp(-beat*15)*.25;
  const hat=noise*Math.exp(-half*150)*.028;
  const bass=Math.sin(2*Math.PI*root*t)*Math.min(1,beat*50)*Math.exp(-beat*3)*.13;
  const arpTime=t%.25,arp=notes[Math.floor(t/.25)%8];
  const pluck=(Math.sin(2*Math.PI*arp*t)+.18*Math.sin(2*Math.PI*arp*2*t))*Math.exp(-arpTime*12)*Math.min(1,arpTime*300)*.052;
  const pad=(Math.sin(2*Math.PI*root*4*t)+Math.sin(2*Math.PI*root*6*t)+Math.sin(2*Math.PI*root*8.01*t))*.018;
  const fade=Math.min(1,t/.45,(seconds-t)/1.8),v=(kick+hat+bass+pluck+pad)*fade;
  peak=Math.max(peak,Math.abs(v));out.writeInt16LE(Math.round(Math.max(-.98,Math.min(.98,v)) * 32767),44+i*4);out.writeInt16LE(Math.round(Math.max(-.98,Math.min(.98,v*.97+pad*.15*fade))*32767),46+i*4);
}
writeFileSync(new URL('./public/junction-pulse.wav',import.meta.url),out);
console.log(JSON.stringify({seconds,rate,channels:2,peak,bytes:out.length,source:'original procedural composition; no third-party samples'}));
