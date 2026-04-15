
let unitsData = [];
let currentUnit = 1;
let quizState = null;
let autoTimer = null;
const TTS_LANG = 'zh-TW';

function $(id){ return document.getElementById(id); }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function speakWord(text){ try{ window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang=TTS_LANG; u.rate=0.9; window.speechSynthesis.speak(u);}catch(e){} }
function initTabs(){
  const buttons = document.querySelectorAll('.tabBtn');
  const panels = { progress: $('tab-progress'), review: $('tab-review'), quiz: $('tab-quiz') };
  function activate(name){ buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab===name)); Object.entries(panels).forEach(([k,p])=>p.classList.toggle('active', k===name)); }
  buttons.forEach(btn=>btn.addEventListener('click', ()=>activate(btn.dataset.tab)));
}
async function loadUnits(){
  const res = await fetch('/api/units'); unitsData = await res.json();
  const sel = $('unitSelect');
  for(let i=1;i<=UNITS_COUNT;i++){ const op=document.createElement('option'); op.value=i; op.textContent=`單元 ${i}｜Bài ${i}`; sel.appendChild(op); }
  sel.value='1'; currentUnit=1; renderWordGrid(); renderQuizIntro();
}
function getUnitWords(){ return unitsData[currentUnit-1] || []; }
function renderWordGrid(){
  const box = $('wordGrid'); const words = getUnitWords();
  box.innerHTML = words.map(w => `<button type="button" class="wordTile" data-id="${w.id}">${w.zh}</button>`).join('');
  box.querySelectorAll('.wordTile').forEach((btn, idx)=> btn.addEventListener('click', ()=> openWord(words[idx])));
}
function openWord(word){
  speakWord(word.zh);
  $('wordModalBody').innerHTML = `<div class="wordZhBig">${word.zh}</div><div class="wordPy">${word.pinyin}</div><div class="wordVi">${word.vi}</div>`;
  $('wordModal').classList.add('show');
}
function sampleOptions(unitWords, currentId, answerField){
  return shuffle(unitWords.filter(w=>w.id!==currentId)).slice(0,3).map(w=>({wordId:w.id,label:w[answerField], pinyin:w.pinyin}));
}
function startQuiz(){
  const unitNo = Number($('unitSelect').value || 1); currentUnit = unitNo;
  const mode = $('quizMode').value; const words = getUnitWords();
  const promptField = mode==='zh-vi' ? 'zh' : 'vi'; const answerField = mode==='zh-vi' ? 'vi' : 'zh';
  const questions = words.map(w=>({
    wordId:w.id,prompt:w[promptField],correctWordId:w.id,correctLabel:w[answerField],pinyin:w.pinyin,zh:w.zh,vi:w.vi,
    options: shuffle([{wordId:w.id,label:w[answerField], pinyin:w.pinyin}, ...sampleOptions(words,w.id,answerField)])
  }));
  quizState = { unitNo, mode, questions, index:0, responses:{}, finished:false };
  renderQuiz();
}
function renderQuizIntro(){
  const area=$('quizArea'); if(!area) return;
  area.innerHTML = `<button class="btn" id="startQuiz" type="button">開始小遊戲<br><span>Bắt đầu trò chơi</span></button>`;
  $('startQuiz').onclick = startQuiz;
}
function scoreQuiz(){
  const q=quizState; const total=q.questions.length||1; let correct=0;
  q.questions.forEach((qq,i)=>{ const r=q.responses[i]; if(r && r.wordId===qq.correctWordId) correct++; });
  return { score: Math.round(correct/total*100), correct, total, familiarityGain: Math.round((Math.round(correct/total*100))*0.3) };
}
async function syncPractice(result){
  const res = await fetch('/student/record-practice', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({unit_no:String(quizState.unitNo), score: result.score, familiarity_gain: result.familiarityGain, points: Math.max(1, Math.round(result.score/20))})});
  const data = await res.json();
  if(data.ok){
    $('metricWeekly') && ($('metricWeekly').textContent = data.weekly_points);
    $('metricPacks') && ($('metricPacks').textContent = data.completed_packs);
    $('metricSignDays') && ($('metricSignDays').textContent = data.sign_days);
    const fill=$('fill-'+quizState.unitNo), sc=$('score-'+quizState.unitNo);
    if(fill) fill.style.width = data.unit_familiarity + '%'; if(sc) sc.textContent = data.unit_familiarity + '%';
    return data;
  }
  return null;
}
async function finishQuiz(){
  clearTimeout(autoTimer);
  const result=scoreQuiz(); quizState.finished=true; quizState.result=result;
  quizState.serverData = await syncPractice(result);
  renderQuiz();
}
function scheduleNext(){ clearTimeout(autoTimer); autoTimer=setTimeout(()=>{ if(!quizState||quizState.finished) return; if(!quizState.responses[quizState.index]) return; if(quizState.index<quizState.questions.length-1){ quizState.index++; renderQuiz(); } else { finishQuiz(); } }, 950); }
function optionHTML(opt, q, resp){
  const isCorrect = opt.wordId===q.correctWordId; const isChosen = resp && resp.wordId===opt.wordId;
  let cls='quizOpt'; if(resp){ if(isCorrect) cls+=' correct'; else if(isChosen) cls+=' wrong'; }
  let main = `<span class="quizOptMain">${opt.label}</span>`;
  let sub='';
  if(resp && isCorrect){ sub = `<span class="quizOptSub">${q.pinyin}</span>`; }
  return `<button class="${cls}" data-wordid="${opt.wordId}" type="button">${main}${sub}</button>`;
}
function promptHTML(q){
  if(quizState.mode==='zh-vi') return `<div class="quizPromptZh">${q.zh}</div><div class="quizPromptPy">${q.pinyin}</div>`;
  return `<div class="quizPromptVi">${q.vi}</div>`;
}
function renderQuiz(){
  const area=$('quizArea'); if(!quizState){ renderQuizIntro(); return; }
  if(quizState.finished){
    const r=quizState.result; const awarded = quizState.serverData?.sign_in_awarded;
    area.innerHTML = `<div class="quizResultBox"><div class="quizScore">總分｜Tổng điểm：${r.score} / 100</div><div class="quizGain">熟悉度 +${r.familiarityGain} 分｜Mức độ quen thuộc +${r.familiarityGain} điểm</div><div class="scoreTips">${r.score>=80?'已完成簽到｜Đã hoàn thành điểm danh':'未達 80 分，尚未完成簽到｜Chưa đạt 80 điểm nên chưa hoàn thành điểm danh'}${awarded?'（今日已記錄）｜(Đã ghi nhận hôm nay)':''}</div></div><button class="btn secondary" id="restartQuiz" type="button">再玩一次<br><span>Chơi lại</span></button>`;
    $('restartQuiz').onclick = startQuiz; return;
  }
  const q=quizState.questions[quizState.index]; const resp=quizState.responses[quizState.index];
  area.innerHTML = `<div class="quizMeta"><span>第 ${quizState.index+1} / ${quizState.questions.length} 題｜Câu ${quizState.index+1} / ${quizState.questions.length}</span><span>${quizState.mode==='zh-vi'?'看漢語選越南文｜Nhìn tiếng Trung chọn tiếng Việt':'看越南文選漢語｜Nhìn tiếng Việt chọn tiếng Trung'}</span></div>${promptHTML(q)}<div class="quizOpts">${q.options.map(opt=>optionHTML(opt,q,resp)).join('')}</div><div class="actions"><button class="btn secondary" id="prevQ" type="button">上一題<br><span>Câu trước</span></button><button class="btn secondary" id="nextQ" type="button">下一題<br><span>Câu sau</span></button></div>`;
  area.querySelectorAll('[data-wordid]').forEach(btn=>btn.onclick=()=>{ if(quizState.responses[quizState.index]) return; const opt=q.options.find(o=>o.wordId===btn.dataset.wordid); quizState.responses[quizState.index]=opt; renderQuiz(); scheduleNext(); });
  $('prevQ').onclick=()=>{ clearTimeout(autoTimer); if(quizState.index>0){ quizState.index--; renderQuiz(); } };
  $('nextQ').onclick=()=>{ clearTimeout(autoTimer); if(!quizState.responses[quizState.index]) return; if(quizState.index<quizState.questions.length-1){ quizState.index++; renderQuiz(); } else { finishQuiz(); } };
}
window.addEventListener('DOMContentLoaded', async ()=>{
  initTabs(); await loadUnits();
  $('unitSelect').addEventListener('change', e=>{ currentUnit = Number(e.target.value); renderWordGrid(); quizState=null; renderQuizIntro(); });
  $('quizMode').addEventListener('change', ()=>{ quizState=null; renderQuizIntro(); });
  $('wordModalClose').addEventListener('click', ()=> $('wordModal').classList.remove('show'));
  $('wordModal').addEventListener('click', (e)=>{ if(e.target=== $('wordModal')) $('wordModal').classList.remove('show'); });
});
