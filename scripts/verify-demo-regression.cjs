const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['regression','conversion','host'];
const allowed = new Set(['regression', 'conversion', 'host', 'edges']);
const css = fs.readFileSync(path.join(root,'packages/react/src/captchavatye.css'),'utf8');
const classes = [...new Set([...css.matchAll(/\.(cv-[a-zA-Z][\w-]*)/g)].map(m=>m[1]))].sort((a,b)=>b.length-a.length);
const replacements = [
 ['인증하고 등록하기','등록'], ['인증 결과 이어보기','등록'], ['게시글이 등록됐어요','등록 완료'],
 ['모의 시승 신청 완료','신청 완료'], ["name: '모의 시승 신청', exact: true", "name: 'BMW M3 모의 시승 신청', exact: true"],
 ['같은 내용으로 다시 시도','다시 시도'], ['시연 전시장','전시장'], ['시연 시간','시간'],
 ['광고 데모로 돌아가기','처음으로'], ['아직 위치가 맞지 않아요','위치가 맞지 않습니다'],
];
let failed = false;
for (const name of names) {
 assert.ok(allowed.has(name), '검증 이름: regression, conversion, host, edges');
 const source = path.join(root,'scripts/browser','verify.'+name+'.cjs');
 const output = path.join(root,'artifacts/sdk-regression',name);
 fs.mkdirSync(output,{recursive:true});
 let text = fs.readFileSync(source,'utf8');
 for (const [old,value] of replacements) text=text.replaceAll(old,value);
 for (const value of classes) text=text.replaceAll('.'+value.slice(3),'.'+value);
 const runner=path.join(output,'verify.'+name+'.cjs');
 fs.writeFileSync(runner,text);
 const result=spawnSync(process.execPath,[runner],{cwd:root,env:process.env,encoding:'utf8'});
 fs.writeFileSync(path.join(output,'execution.log'),result.stdout+result.stderr);
 console.log(name+': exit '+result.status+'\n'+result.stdout+result.stderr);
 if(result.status!==0 || result.error) failed=true;
}
if(failed) process.exitCode=1;
