
let unitsData = [];
let flashState = { unit: 1, mode: 'zh-vi', index: 0, showBack: false };
let quizState = null;
let autoTimer = null;

function $(id){ return document.getElementById(id); }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function sampleOtherOptions(unitWords, currentId, answerField){
  return shuffle(unitWords.filter(w=>w.id!==currentId)).slice(0,3).map(w=>({wordId:w.id,label:w[answerField]}));
}
function initTabs(){
  const buttons = document.querySelectorAll('.tabBtn');
  const panels = { progress: $('tab-progress'), practice: $('tab-practice') };
  function activate(name){ buttons.forEach(btn=>btn.classList.toggle('active', btn.dataset.tab===name)); Object.entries(panels).forEach(([k,p])=>p.classList.toggle('active', k===name)); }
  buttons.forEach(btn=>btn.addEventListener('click', ()=>activate(btn.dataset.tab)));
}
async function loadUnits(){
  const res = await fetch('/api/units');
  unitsData = await res.json();
  const sel = $('unitSelect');
  for(let i=1;i<=UNITS_COUNT;i++){
    const op=document.createElement('option'); op.value=i; op.textContent=`單元 ${i}`; sel.appendChild(op);
  }
  sel.value='1';
  renderFlashCard();
}
function currentUnitWords(){ return unitsData[flashState.unit-1] || []; }
function renderFlashCard(){
  const words=currentUnitWords(); if(!words.length){ $('flashFront').textContent='沒有資料'; $('flashBack').textContent=''; return; }
  const word=words[flashState.index % words.length];
  const mode=flashState.mode;
  $('flashLabel').textContent = flashState.showBack ? '點卡片回到正面' : '點卡片翻面';
  if(mode==='zh-vi'){
    $('flashFront').textContent = flashState.showBack ? word.vi : word.zh;
    $('flashBack').textContent = flashState.showBack ? word.pinyin : '';
  } else {
    $('flashFront').textContent = flashState.showBack ? word.zh : word.vi;
    $('flashBack').textContent = flashState.showBack ? word.pinyin : '';
  }
}
function nextCard(dir=1){ const words=currentUnitWords(); if(!words.length) return; flashState.index=(flashState.index+dir+words.length)%words.length; flashState.showBack=false; renderFlashCard(); }
function startQuiz(){
  const unitNo = Number($('unitSelect').value || 1);
  const mode = $('quizMode').value;
  const words = unitsData[unitNo-1] || [];
  const promptField = mode==='zh-vi' ? 'zh' : 'vi';
  const answerField = mode==='zh-vi' ? 'vi' : 'zh';
  const questions = words.map(w=>({
    wordId:w.id,
    prompt:w[promptField],
    correctWordId:w.id,
    correctLabel:w[answerField],
    pinyin:w.pinyin,
    zh:w.zh,
    vi:w.vi,
    options: shuffle([{wordId:w.id,label:w[answerField]}, ...sampleOtherOptions(words, w.id, answerField)])
  }));
  quizState = { unitNo, mode, questions, index:0, responses:{}, finished:false, wrongWords:[] };
  renderQuiz();
}
function scoreQuiz(){
  const q=quizState; const total=q.questions.length || 1;
  let correct=0; const wrong=[];
  q.questions.forEach((qq, i)=>{
    const r=q.responses[i];
    if(r && r.wordId===qq.correctWordId) correct++;
    else wrong.push({zh:qq.zh, pinyin:qq.pinyin, vi:qq.vi});
  });
  return {score: Math.round(correct/total*100), correct, total, wrong};
}
async function syncPractice(score){
  const res = await fetch('/student/record-practice', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({unit_no:String(quizState.unitNo), score, familiarity_gain: Math.round(score*0.3), points: Math.max(1, Math.round(score/20))})});
  const data = await res.json();
  if(data.ok){
    if($('metricWeekly')) $('metricWeekly').textContent = data.weekly_points;
    if($('metricPacks')) $('metricPacks').textContent = data.completed_packs;
    const fill=$('fill-'+quizState.unitNo), sc=$('score-'+quizState.unitNo);
    if(fill) fill.style.width = data.unit_familiarity + '%';
    if(sc) sc.textContent = data.unit_familiarity + '%';
  }
}
function finishQuiz(){
  clearTimeout(autoTimer);
  const result=scoreQuiz();
  quizState.finished=true; quizState.result=result;
  renderQuiz();
  syncPractice(result.score);
}
function scheduleNext(){
  clearTimeout(autoTimer);
  autoTimer = setTimeout(()=>{
    if(!quizState || quizState.finished) return;
    if(!quizState.responses[quizState.index]) return;
    if(quizState.index < quizState.questions.length-1){ quizState.index++; renderQuiz(); }
    else { finishQuiz(); }
  }, 900);
}
function renderQuiz(){
  const area=$('quizArea');
  if(!quizState){ area.innerHTML='<p class="small">按開始後，會用該單元全部單字出題。</p><button class="btn" id="startQuiz" type="button">開始小遊戲</button>'; $('startQuiz').onclick=startQuiz; return; }
  if(quizState.finished){
    const r=quizState.result;
    area.innerHTML = `<div class="quizMeta"><strong>本次分數：${r.score} / 100</strong><span>${r.correct} / ${r.total} 題答對</span></div>
      <button class="btn secondary" id="restartQuiz" type="button">重新開始</button>
      ${r.wrong.length?`<div class="wrongList"><strong>錯題複習</strong>${r.wrong.map(w=>`<div>${w.zh}｜${w.pinyin}｜${w.vi}</div>`).join('')}</div>`:''}`;
    $('restartQuiz').onclick=startQuiz; return;
  }
  const q=quizState.questions[quizState.index];
  const resp=quizState.responses[quizState.index];
  area.innerHTML = `<div class="quizMeta"><span>第 ${quizState.index+1} / ${quizState.questions.length} 題</span><span>${quizState.mode==='zh-vi'?'看中文選越南文':'看越南文選中文'}</span></div>
    <div class="quizQuestion">${q.prompt}</div>
    <div class="quizOpts">${q.options.map((opt,idx)=>{
      let cls='quizOpt';
      if(resp){
        if(opt.wordId===q.correctWordId) cls+=' correct';
        else if(resp.wordId===opt.wordId) cls+=' wrong';
      }
      return `<button class="${cls}" data-opt="${idx}" type="button">${opt.label}</button>`;
    }).join('')}</div>
    <div class="actions"><button class="btn secondary" id="prevQ" type="button">上一題</button><button class="btn secondary" id="nextQ" type="button">下一題</button></div>
    ${resp && resp.wordId!==q.correctWordId ? `<div class="wrongList"><div><strong>這題答錯</strong></div><div>${q.zh}｜${q.pinyin}｜${q.vi}</div></div>` : ''}`;
  area.querySelectorAll('[data-opt]').forEach(btn=>btn.onclick=()=>{
    if(quizState.responses[quizState.index]) return;
    const opt=q.options[Number(btn.dataset.opt)];
    quizState.responses[quizState.index]=opt;
    renderQuiz();
    scheduleNext();
  });
  $('prevQ').onclick=()=>{ clearTimeout(autoTimer); if(quizState.index>0){ quizState.index--; renderQuiz(); } };
  $('nextQ').onclick=()=>{ clearTimeout(autoTimer); if(!quizState.responses[quizState.index]) return; if(quizState.index<quizState.questions.length-1){ quizState.index++; renderQuiz(); } else { finishQuiz(); } };
}
window.addEventListener('DOMContentLoaded', async ()=>{
  initTabs();
  await loadUnits();
  $('unitSelect').addEventListener('change', e=>{ flashState.unit=Number(e.target.value); flashState.index=0; flashState.showBack=false; renderFlashCard(); quizState=null; renderQuiz(); });
  $('flipMode').addEventListener('change', e=>{ flashState.mode=e.target.value; flashState.showBack=false; renderFlashCard(); });
  $('quizMode').addEventListener('change', ()=>{ quizState=null; renderQuiz(); });
  $('flashCard').addEventListener('click', ()=>{ flashState.showBack=!flashState.showBack; renderFlashCard(); });
  $('prevCard').onclick=()=>nextCard(-1);
  $('nextCard').onclick=()=>nextCard(1);
  renderQuiz();
});
