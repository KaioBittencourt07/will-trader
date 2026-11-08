import {getHealth,getMarketStatus,scanOpportunities,getHistory,getMetrics,registerOutcome,confirmExecution} from './api.js';
const $=id=>document.getElementById(id);
let running=false,busy=false,timer=null,lastRecommendation=null,activeHistoryId=null,openSignals=[],lastMetrics=null,lastStudies=[],reviewedStudyAsset=null;
let rounds=Number(sessionStorage.getItem('will.validRounds')||0);
let sessionValid=Number(sessionStorage.getItem('will.validStudies')||0);
const NORMAL_COOLDOWN=20,EMPTY_COOLDOWN=20;
const fmt=t=>t?new Date(t).toLocaleTimeString('pt-BR',{hour12:false}):'—';
const isValidRecord=r=>r?.metadata?.dataQuality?.valid!==false&&!((r?.metadata?.blockReasons||[]).some(reason=>/^(DATA_QUALITY_|Dados atrasados\.)/.test(String(reason))));
function evidenceView(m={}){const f=m.funnel||{};const observations=Number(f.observations??m.signals??0);const rejected=Number(f.dataRejected??0);return{valid:Math.max(0,observations-rejected),strategyWaits:Number(f.strategyWaits??0)}}
function persistSession(){sessionStorage.setItem('will.validRounds',String(rounds));sessionStorage.setItem('will.validStudies',String(sessionValid));$('rounds').textContent=rounds;$('totalScanned').textContent=sessionValid}
function setState(text){$('autoState').textContent=text}
function resetTimer(){if(timer){clearInterval(timer);timer=null}}
function stopAuto(message='Rotação pausada pelo operador.'){running=false;resetTimer();setState('PARADO');$('auto').disabled=false;$('stop').disabled=true;$('countdown').textContent='—';$('progress').style.width='0';$('reason').textContent=message}
function renderRanking(r={}) {
  const list=$('ranking');
  list.replaceChildren();
  const items=Array.isArray(r.candidates)?r.candidates:[];
  if(!items.length){const empty=document.createElement('li');empty.className='muted';empty.textContent='Nenhum ativo aprovado nesta rodada.';list.append(empty);return;}
  items.slice(0,8).forEach((item,i)=>{
    const li=document.createElement('li');
    li.classList.add('rankingItem');
    const number=document.createElement('span');number.textContent='#'+(i+1);
    const name=document.createElement('strong');name.textContent=item.asset||'—';
    const tag=document.createElement('span');tag.className='tag';tag.textContent=item.readiness?.classification||item.readiness?.status||'ANALISADO';
    li.append(number,name,tag);
    li.title='Selecionar '+(item.asset||'ativo')+' na análise detalhada';
    li.addEventListener('click',()=>{
      const select=$('studyAsset');
      if([...select.options].some(option=>option.value===item.asset)){select.value=item.asset;renderSelectedStudy();}
    });
    list.append(li);
  });
}

const SVG_NS='http://www.w3.org/2000/svg';
function svgNode(name,attributes={},text=''){
  const node=document.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  if(text)node.textContent=text;
  return node;
}
function priceText(value){
  if(value===null||value===undefined||value==='')return '—';
  const number=Number(value);
  if(!Number.isFinite(number))return '—';
  return number.toLocaleString('pt-BR',{maximumFractionDigits:number>=100?2:5});
}
function renderCandlestickChart(study){
  const svg=$('priceChart');
  svg.replaceChildren();
  const candles=Array.isArray(study?.candles)?study.candles:[];
  if(!candles.length){
    svg.append(svgNode('text',{x:500,y:160,'text-anchor':'middle',class:'chartEmpty'},'Aguardando candles válidos do ativo selecionado.'));
    return;
  }
  const width=1000,height=320,pad=34;
  const lows=candles.map(c=>Number(c.low)).filter(Number.isFinite);
  const highs=candles.map(c=>Number(c.high)).filter(Number.isFinite);
  let minimum=Math.min(...lows),maximum=Math.max(...highs);
  if(!Number.isFinite(minimum)||!Number.isFinite(maximum)){
    svg.append(svgNode('text',{x:500,y:160,'text-anchor':'middle',class:'chartEmpty'},'Candles indisponíveis.'));
    return;
  }
  if(maximum===minimum){const delta=Math.max(Math.abs(maximum)*0.0005,0.00001);minimum-=delta;maximum+=delta;}
  const y=value=>height-pad-((Number(value)-minimum)/(maximum-minimum))*(height-pad*2);
  for(let i=0;i<=4;i++){
    const yy=pad+i*((height-pad*2)/4);
    svg.append(svgNode('line',{x1:pad,y1:yy,x2:width-pad,y2:yy,class:'chartGrid'}));
  }
  const step=(width-pad*2)/candles.length;
  const bodyWidth=Math.max(2,Math.min(14,step*.58));
  candles.forEach((candle,index)=>{
    const x=pad+index*step+step/2;
    const up=Number(candle.close)>=Number(candle.open);
    svg.append(svgNode('line',{x1:x,y1:y(candle.high),x2:x,y2:y(candle.low),class:up?'candleWickUp':'candleWickDown'}));
    const top=Math.min(y(candle.open),y(candle.close));
    const bodyHeight=Math.max(1,Math.abs(y(candle.open)-y(candle.close)));
    svg.append(svgNode('rect',{x:x-bodyWidth/2,y:top,width:bodyWidth,height:bodyHeight,rx:1,class:up?'candleUp':'candleDown'}));
  });
  svg.append(svgNode('text',{x:pad,y:18,class:'chartAxis'},priceText(maximum)));
  const first=candles[0].timestamp,last=candles[candles.length-1].timestamp;
  svg.append(svgNode('text',{x:pad,y:height-6,dx:58,class:'chartAxis'},fmt(first)));
  svg.append(svgNode('text',{x:width-pad,y:height-6,'text-anchor':'end',class:'chartAxis'},fmt(last)));
}
function metricText(value){return value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?Number(value).toFixed(2):'—';}
function renderSelectedStudy(){
  const asset=$('studyAsset').value;
  const study=lastStudies.find(item=>item.asset===asset);
  if(!study){
    $('studyStatus').textContent='Nenhum estudo válido disponível nesta rodada.';$('reviewStudy').disabled=true;$('reviewStudy').textContent='REVISAR SINAL DO ATIVO';
    $('studyPrice').textContent='—';$('studyTrend').textContent='—';$('studyMomentum').textContent='—';$('studyVolatility').textContent='—';$('studyConfirmations').textContent='—';
    $('studyDecision').textContent='Aguardando um ativo passar pelos filtros de qualidade de dados.';
    $('studyDecision').className='studyDecision wait';
    renderCandlestickChart(null);
    return;
  }
  const decision=study.decision||{},indicators=study.indicators||{};
  $('studyStatus').textContent=(study.source||'feed')+' · '+(study.timeframe||'—')+' · '+study.candles.length+' candles · '+fmt(study.timestamp);
  $('studyPrice').textContent=priceText(study.price);
  $('studyTrend').textContent=metricText(indicators.trend);
  $('studyMomentum').textContent=metricText(indicators.momentum);
  $('studyVolatility').textContent=metricText(indicators.volatility);
  $('studyConfirmations').textContent=indicators.confirmations===null||indicators.confirmations===undefined||indicators.confirmations===''?'—':Number.isFinite(Number(indicators.confirmations))?String(Number(indicators.confirmations)):'—';
  const reviewed=reviewedStudyAsset===study.asset;
  $('reviewStudy').disabled=false;
  $('reviewStudy').textContent=reviewed?'SINAL REVISADO':'REVISAR SINAL DO ATIVO';
  if(reviewed){
    const reasons=Array.isArray(decision.blockReasons)?decision.blockReasons.join(', '):'';
    $('studyDecision').textContent=decision.direction+' · '+decision.setup+' · '+decision.regime+' · Score '+(decision.score??'—')+' · Confiança heurística '+(decision.confidence??'—')+'%'+(reasons?' · '+reasons:'');
    $('studyDecision').className='studyDecision '+String(decision.direction||'WAIT').toLowerCase();
  }else{
    $('studyDecision').textContent='Direção e sinal ocultos até sua revisão manual. Os dados técnicos e candles já estão disponíveis.';
    $('studyDecision').className='studyDecision wait';
  }
  renderCandlestickChart(study);
}
function renderStudies(studies=[]){
  lastStudies=Array.isArray(studies)?studies:[];
  reviewedStudyAsset=null;
  const select=$('studyAsset');
  const previous=select.value;
  select.replaceChildren();
  if(!lastStudies.length){
    select.append(new Option('Aguardando estudo válido',''));
    select.disabled=true;
    renderSelectedStudy();
    return;
  }
  for(const study of lastStudies)select.append(new Option(study.asset,study.asset));
  select.disabled=false;
  select.value=lastStudies.some(study=>study.asset===previous)?previous:lastStudies[0].asset;
  renderSelectedStudy();
}
function renderPerformance(result={}){
  const latency=result.latency||{},stages=latency.stages||{},provider=result.providerEfficiency||{};
  $('scanLatency').textContent=Number.isFinite(Number(latency.totalMs))?Math.round(Number(latency.totalMs))+' ms':'—';
  $('marketLatency').textContent=Number.isFinite(Number(stages.marketFetchMs))?Math.round(Number(stages.marketFetchMs))+' ms':'—';
  $('apiCalls').textContent=String(provider.externalRequests??'—');
  $('cacheDedup').textContent=String(provider.cacheHits??0)+' / '+String(provider.deduplicated??0);
  $('rateLimitEvents').textContent=String(provider.rateLimitEvents??0);
}

function stageRecommendation(r={}){lastRecommendation=r.recommendation||null;if(!lastRecommendation){$('asset').textContent='Nenhum candidato nesta rodada válida';$('direction').textContent='WAIT';$('direction').className='direction wait';$('detail').textContent='Os filtros estratégicos não liberaram candidato. A rotação continua.';$('review').disabled=true;return}$('asset').textContent=lastRecommendation.decision?.asset||lastRecommendation.snapshot?.asset||'Candidato disponível';$('direction').textContent='CANDIDATO';$('direction').className='direction wait';$('detail').textContent='O scanner encontrou uma oportunidade para revisão. A direção permanece oculta até sua ação.';$('review').disabled=false}
function review(){if(!lastRecommendation)return;const reviewedAsset=lastRecommendation.asset||lastRecommendation.snapshot?.asset;if(reviewedAsset){reviewedStudyAsset=reviewedAsset;const select=$('studyAsset');if([...select.options].some(option=>option.value===reviewedAsset))select.value=reviewedAsset;renderSelectedStudy();}const d=lastRecommendation.decision||{};const dir=d.direction||'WAIT';$('direction').textContent=dir;$('direction').className=`direction ${dir==='BUY'?'buy':dir==='SELL'?'sell':'wait'}`;$('asset').textContent=d.asset||lastRecommendation.snapshot?.asset||'—';$('detail').textContent=dir==='WAIT'?'Os filtros atuais não liberaram entrada.':'Análise exibida para sua avaliação; nenhuma execução é automática.';activeHistoryId=lastRecommendation.historyId||null;refreshLearning()}
function localInput(iso){if(!iso)return'';const date=new Date(iso);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
function updateOutcomeTab(){const select=$('outcomeSignal');select.replaceChildren();if(!openSignals.length){select.append(new Option('Nenhuma operação aberta',''));select.disabled=true;activeHistoryId=null;$('outcomeLabel').textContent='Depois de revisar uma análise e executar manualmente, a operação aparecerá aqui.';$('actualClick').value='';$('actualClick').disabled=true;$('actualPrice').value='';$('actualPrice').disabled=true;$('confirmExecution').disabled=true;$('win').disabled=true;$('loss').disabled=true;return}for(const item of openSignals){const click=item.clickTime?` · entrada ${fmt(item.clickTime)}`:'';select.append(new Option(`${item.asset} · ${item.direction} · ${item.confidence}%${click}`,item.id))}const preferred=openSignals.find(item=>item.id===activeHistoryId)||openSignals[0];activeHistoryId=preferred.id;select.value=activeHistoryId;select.disabled=false;const execution=preferred.execution||{};const confirmed=execution.status==='CONFIRMED';$('actualClick').value=localInput(execution.actualClickTime);$('actualClick').disabled=confirmed;$('actualPrice').value=execution.actualEntryPrice??'';$('actualPrice').disabled=confirmed;$('confirmExecution').disabled=confirmed;$('win').disabled=!confirmed;$('loss').disabled=!confirmed;$('outcomeLabel').textContent=confirmed?`${preferred.asset} · ${preferred.direction}. Entrada confirmada em ${fmt(execution.actualClickTime)}. Agora registre WIN ou LOSS.`:`${preferred.asset} · ${preferred.direction}. Informe a entrada realmente executada.`}
async function refreshLearning(){try{const [h,mr]=await Promise.all([getHistory(250),getMetrics()]);const m=mr.metrics||{},e=evidenceView(m);$('signals').textContent=e.valid;$('waits').textContent=e.strategyWaits;$('outcomes').textContent=m.total?`${m.wins||0} / ${m.losses||0}`:'—';const completed=Number(m.total||0),wins=Number(m.wins||0);$('winRate').textContent=completed?`${((wins/completed)*100).toFixed(1)}%`:'—';$('learningStatus').textContent=completed?`Base válida: ${e.valid} estudo(s) e ${completed} resultado(s) concluído(s).`:`Base válida: ${e.valid} estudo(s), ${e.strategyWaits} WAIT(s) estratégico(s). Ainda faltam WIN/LOSS reais para medir desempenho.`;const validRecords=(h.records||[]).filter(isValidRecord);openSignals=validRecords.filter(record=>record.status==='OPEN');updateOutcomeTab();const list=$('history');list.replaceChildren();if(!validRecords.length){list.innerHTML='<li class="muted">Sem estudos válidos registrados.</li>';lastMetrics=m;return m}for(const r of validRecords.slice(0,8)){const li=document.createElement('li');li.textContent=`${r.asset||'—'} · ${r.direction||'WAIT'} · ${r.confidence??'—'}% · ${r.outcome||r.status||'—'}`;list.append(li)}lastMetrics=m;return m}catch{$('learningStatus').textContent='Base de resultados temporariamente indisponível. O scanner continuará tentando.';return lastMetrics}}
function scheduleNext(seconds=NORMAL_COOLDOWN){resetTimer();let left=Math.max(1,Math.ceil(seconds));setState('COOLDOWN');$('countdown').textContent=`${left}s`;$('progress').style.width='0';const totalSeconds=left;timer=setInterval(()=>{left-=1;$('countdown').textContent=left>0?`${left}s`:'agora';$('progress').style.width=`${Math.min(100,((totalSeconds-left)/totalSeconds)*100)}%`;if(left<=0){resetTimer();executeRound().catch(()=>{})}},1000)}
async function providerAwareDelay(fallback=NORMAL_COOLDOWN){try{const m=await getMarketStatus();const cooldownMs=Number(m?.relay?.cooldownMs||0);if(cooldownMs>0)return Math.max(fallback,Math.ceil(cooldownMs/1000)+2)}catch{}return fallback}
async function executeRound(){if(!running||busy)return;busy=true;setState('ANALISANDO');$('reason').textContent='Buscando o próximo estudo válido…';$('progress').style.width='35%';try{const before=evidenceView(lastMetrics||{});const r=await scanOpportunities('1min',Number($('entryDelay').value));if(!r?.ok)throw new Error(r?.error||'Scanner indisponível');renderStudies(r.studies||[]);renderPerformance(r);$('batch').textContent=Number(r.scanned||0)?`${Number(r.scanned||0)} válido(s)`:'aguardando';$('nextAsset').textContent=r.coverage?.nextAsset||(r.coverage?.completesCycle?'novo ciclo':'—');$('progress').style.width='100%';const afterMetrics=await refreshLearning();const after=evidenceView(afterMetrics||{});const validDelta=Math.max(0,after.valid-before.valid);if(validDelta>0){rounds+=1;sessionValid+=validDelta;persistSession();renderRanking(r);stageRecommendation(r);$('reason').textContent=`Ciclo válido ${rounds}: ${validDelta} novo(s) estudo(s) gravado(s).`}else{$('reason').textContent='Aguardando a próxima leitura válida do mercado.'}if(running)scheduleNext(await providerAwareDelay(validDelta>0?NORMAL_COOLDOWN:EMPTY_COOLDOWN))}catch{$('reason').textContent='Aguardando a próxima leitura válida do mercado.';if(running)scheduleNext(await providerAwareDelay(EMPTY_COOLDOWN))}finally{busy=false}}
function startAuto(){if(running)return;running=true;$('auto').disabled=true;$('stop').disabled=false;$('review').disabled=true;setState('INICIANDO');$('reason').textContent='AUTO SCAN iniciado. Procurando estudos válidos…';executeRound().catch(()=>{})}
async function confirmActual(){if(!activeHistoryId)return;$('confirmExecution').disabled=true;try{await confirmExecution(activeHistoryId,{actualClickTime:$('actualClick').value,actualEntryPrice:$('actualPrice').value,notes:'operator-manual-external-broker'});$('reason').textContent='Entrada manual registrada. Quando encerrar, marque WIN ou LOSS.';await refreshLearning()}catch(error){$('reason').textContent=`Entrada: ${error.message}`;$('confirmExecution').disabled=false}}
async function settle(outcome){if(!activeHistoryId)return;$('win').disabled=true;$('loss').disabled=true;try{const result=await registerOutcome(activeHistoryId,outcome,{source:'operator-manual',recordedBy:'operator'});const learning=result.learning||{},metrics=learning.metrics||{};$('reason').textContent=`${outcome} registrado. Evidência: ${metrics.wins||0} WIN / ${metrics.losses||0} LOSS.`;activeHistoryId=null;await refreshLearning()}catch(error){$('reason').textContent=`Resultado: ${error.message}`}finally{$('win').disabled=false;$('loss').disabled=false}}
async function status(){try{const [h,m]=await Promise.all([getHealth(),getMarketStatus()]);$('status').textContent=h.marketConfigured?'ONLINE · ANALYSIS':'SEM FEED';const relay=m.relay||{};$('feed').textContent=relay.coolingDown?`aguardando ${Math.ceil(Number(relay.cooldownMs||0)/1000)}s`:relay.mode==='LOCAL_RELAY'?'relay ativo':'pronto'}catch{$('status').textContent='BACKEND OFFLINE';$('feed').textContent='indisponível'}}
$('studyAsset').onchange=renderSelectedStudy;$('reviewStudy').onclick=()=>{reviewedStudyAsset=$('studyAsset').value;renderSelectedStudy();};$('auto').onclick=startAuto;$('stop').onclick=()=>stopAuto();$('review').onclick=review;$('outcomeSignal').onchange=e=>{activeHistoryId=e.target.value;updateOutcomeTab()};$('confirmExecution').onclick=confirmActual;$('win').onclick=()=>settle('WIN');$('loss').onclick=()=>settle('LOSS');persistSession();status();refreshLearning();setInterval(status,30000);setInterval(refreshLearning,30000);
