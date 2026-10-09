const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PROJECT_ROOT } = require('../config/config');

const outputDir = path.join(PROJECT_ROOT, 'assets', 'coinflip');
const fontPath = path.join(outputDir, 'Montserrat-Bold.ttf');
const resultDir = path.join(outputDir, 'results');
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(resultDir, { recursive: true, force: true });
fs.mkdirSync(resultDir, { recursive: true });

function run(args) {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const circle = '(X-256)*(X-256)+(Y-250)*(Y-250)';
const inside = `lte(${circle}\\,32041)`;
const innerRim = `lte(${circle}\\,33856)`;
const rim = `lte(${circle}\\,35721)`;
const shine = 'max(0\\,1-sqrt((X-198)*(X-198)+(Y-155)*(Y-155))/225)';
const font = fontPath.replace(/:/g, '\\:');

function surface(dark) {
  const faceR = dark ? `20+28*${shine}` : `218+37*${shine}`;
  const faceG = dark ? `22+28*${shine}` : `224+31*${shine}`;
  const faceB = dark ? `28+30*${shine}` : `235+20*${shine}`;
  const innerR = dark ? `55+40*${shine}` : `188+50*${shine}`;
  const innerG = dark ? `58+42*${shine}` : `194+44*${shine}`;
  const innerB = dark ? `67+45*${shine}` : `205+35*${shine}`;
  return `format=rgba,geq=` +
    `r=if(${inside}\\,${faceR}\\,if(${innerRim}\\,${innerR}\\,if(${rim}\\,58+82*${shine}\\,0))):` +
    `g=if(${inside}\\,${faceG}\\,if(${innerRim}\\,${innerG}\\,if(${rim}\\,63+78*${shine}\\,0))):` +
    `b=if(${inside}\\,${faceB}\\,if(${innerRim}\\,${innerB}\\,if(${rim}\\,73+72*${shine}\\,0))):` +
    `a=if(${rim}\\,255\\,0)`;
}

function faceFilter(label, dark) {
  const textColor = dark ? 'white' : 'black';
  const highlight = dark ? 'black@0.55' : 'white@0.7';
  return `${surface(dark)},` +
    `drawtext=fontfile=${font}:text=${label}:fontcolor=${textColor}:fontsize=40:x=(w-text_w)/2:y=143:shadowcolor=${highlight}:shadowx=2:shadowy=2,` +
    `drawtext=fontfile=${font}:text=Z:fontcolor=${textColor}:fontsize=172:x=(w-text_w)/2:y=190:borderw=2:bordercolor=${dark ? 'black@0.55' : 'white@0.45'}:shadowcolor=black@0.35:shadowx=7:shadowy=9,` +
    `drawbox=x=186:y=374:w=140:h=5:color=${textColor}@0.72:t=fill`;
}

run(['-f', 'lavfi', '-i', 'color=c=black@0:s=512x512', '-vf', faceFilter('HEADS', false), '-frames:v', '1', path.join(outputDir, 'heads.png')]);
run(['-f', 'lavfi', '-i', 'color=c=black@0:s=512x512', '-vf', faceFilter('TAILS', true), '-frames:v', '1', path.join(outputDir, 'tails.png')]);
run([
  '-f', 'lavfi', '-i', 'color=c=black@0:s=384x384:r=12,format=rgba',
  '-framerate', '12', '-loop', '1', '-i', path.join(outputDir, 'heads.png'),
  '-framerate', '12', '-loop', '1', '-i', path.join(outputDir, 'tails.png'),
  '-filter_complex',
  `[1:v]scale=384:384,split=3[hface][hedge][hinner];` +
  `[2:v]scale=384:384,split=3[tface][tedge][tinner];` +
  `[hface]scale=w=384:h='max(8,384*abs(cos(PI*t/0.75)))':eval=frame[heads];` +
  `[tface]scale=w=384:h='max(8,384*abs(cos(PI*t/0.75)))':eval=frame[tails];` +
  `[hedge]colorchannelmixer=rr=.14:gg=.16:bb=.2:aa=1,scale=w=384:h='max(84,384*abs(cos(PI*t/0.75)))':eval=frame[headedge];` +
  `[tedge]colorchannelmixer=rr=.14:gg=.16:bb=.2:aa=1,scale=w=384:h='max(84,384*abs(cos(PI*t/0.75)))':eval=frame[tailedge];` +
  `[hinner]colorchannelmixer=rr=.46:gg=.5:bb=.58:aa=1,scale=w=384:h='max(56,384*abs(cos(PI*t/0.75)))':eval=frame[headinner];` +
  `[tinner]colorchannelmixer=rr=.46:gg=.5:bb=.58:aa=1,scale=w=384:h='max(56,384*abs(cos(PI*t/0.75)))':eval=frame[tailinner];` +
  `[0:v][headedge]overlay=x=0:y=(H-h)/2:enable='lt(mod(t,1.5),0.375)+gte(mod(t,1.5),1.125)'[he];` +
  `[he][headinner]overlay=x=0:y=(H-h)/2:enable='lt(mod(t,1.5),0.375)+gte(mod(t,1.5),1.125)'[hi];` +
  `[hi][heads]overlay=x=0:y=(H-h)/2:enable='lt(mod(t,1.5),0.375)+gte(mod(t,1.5),1.125)'[hf];` +
  `[hf][tailedge]overlay=x=0:y=(H-h)/2:enable='between(mod(t,1.5),0.375,1.125)'[te];` +
  `[te][tailinner]overlay=x=0:y=(H-h)/2:enable='between(mod(t,1.5),0.375,1.125)'[ti];` +
  `[ti][tails]overlay=x=0:y=(H-h)/2:enable='between(mod(t,1.5),0.375,1.125)',format=rgba[out]`,
  '-map', '[out]', '-t', '3', '-r', '18', '-loop', '0', path.join(outputDir, 'coinflip.gif'),
]);

function combinations(length, prefix = []) {
  if (prefix.length === length) return [prefix];
  return [...combinations(length, [...prefix, 'heads']), ...combinations(length, [...prefix, 'tails'])];
}

for (let length = 1; length <= 5; length++) {
  for (const sequence of combinations(length)) {
    const inputs = [];
    const streams = [];
    sequence.forEach((result, index) => {
      inputs.push('-i', path.join(outputDir, `${result}.png`));
      streams.push(`[${index}:v]scale=180:180[coin${index}]`);
    });
    const stack = sequence.map((_, index) => `[coin${index}]`).join('');
    const key = sequence.map(result => result === 'heads' ? 'H' : 'T').join('-');
    const compose = sequence.length === 1
      ? `${streams[0]};[coin0]format=rgba[out]`
      : `${streams.join(';')};${stack}hstack=inputs=${sequence.length},format=rgba[out]`;
    run([
      ...inputs,
      '-filter_complex', compose,
      '-map', '[out]', path.join(resultDir, `result-${key}.png`),
    ]);
  }
}
