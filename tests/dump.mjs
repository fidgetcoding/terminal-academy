// Reads the course out of the page so the playthrough can follow what the page shows.
import { BASE, launch, outFile } from './lib.mjs';
import fs from 'fs';
const b = await launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text()); });
p.on('requestfailed', r => console.log('REQFAIL', r.url(), r.failure()?.errorText));
await p.goto(BASE);
await p.waitForTimeout(1500);
const d = await p.evaluate(() => {
  const ser = t => ({...t, validate: t.validate ? t.validate.toString() : undefined});
  return {
    lessons: lessons.map(l => ({...l, tasks: l.tasks.map(ser)})),
    quests: adventureQuests.map(q => ({...q, objectives: q.objectives.map(ser)})),
    challenges: Object.fromEntries(Object.entries(challenges).map(([k,v])=>[k,v.map(ser)])),
    quiz: quizQuestions,
    glossary,
    fs: createFS(),
  };
});
fs.writeFileSync(outFile('course.json'), JSON.stringify(d,null,1));
console.log('lessons',d.lessons.length,'tasks',d.lessons.reduce((a,l)=>a+l.tasks.length,0),'quests',d.quests.length,'objs',d.quests.reduce((a,q)=>a+q.objectives.length,0));
console.log('challenges',Object.entries(d.challenges).map(([k,v])=>k+':'+v.length).join(' '));
console.log('quiz',Object.entries(d.quiz).map(([k,v])=>k+':'+v.length).join(' '));
console.log('glossary',Object.keys(d.glossary).length);
await b.close();
